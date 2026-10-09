/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/gpl-3.0.html>.
 *
 * Local authority for whole-PC optimization. The gateway supplies bounded data; this
 * agent validates it, selects local capabilities, and applies approved work.
 */

import {
  isDestructiveNativeAction,
  validateNativeAction,
  validateNativePlan
} from './protocol.js';
import { validateGatewayUrl } from './gateway-url.js';

const PROFILE_MAP = Object.freeze({ balanced: 'balanced', performance: 'performance', battery: 'battery-mobile' });

function requestIdentifier(now) {
  return `native-${now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function approvalMatches(approvedActions, action) {
  if (approvedActions === true) return true;
  if (!Array.isArray(approvedActions)) return false;
  return approvedActions.includes(action.type) || approvedActions.includes(`${action.type}:${action.value}`);
}

async function readJson(response) {
  if (!response || typeof response.json !== 'function') throw new Error('Gateway returned no JSON response');
  return response.json();
}

export class NativeOptimizerAgent {
  constructor({
    adapter,
    gatewayUrl = process.env.OPTIMIZER_GATEWAY_URL || '',
    gatewayToken = process.env.OPTIMIZER_GATEWAY_TOKEN || '',
    fetchFn = globalThis.fetch,
    clientId = process.env.OPTIMIZER_CLIENT_ID || 'native-local',
    profile = 'balanced',
    targetPid = null,
    approvedBackgroundPids = [],
    now = Date.now,
    timeoutMs = 10000
  } = {}) {
    if (!adapter || typeof adapter.collectFacts !== 'function' || typeof adapter.applyAction !== 'function') {
      throw new TypeError('Native optimizer agent requires a platform adapter');
    }
    if (!Object.hasOwn(PROFILE_MAP, profile)) throw new Error(`Unsupported native profile: ${profile}`);
    this.adapter = adapter;
    this.gatewayUrl = gatewayUrl;
    this.gatewayToken = gatewayToken;
    this.fetchFn = fetchFn;
    this.clientId = clientId;
    this.profile = profile;
    this.targetPid = targetPid;
    this.approvedBackgroundPids = approvedBackgroundPids;
    this.now = now;
    this.timeoutMs = timeoutMs;
  }

  collectFacts() {
    return this.adapter.collectFacts();
  }

  async requestPlan(facts, { profile = this.profile } = {}) {
    if (!this.gatewayUrl) throw new Error('Optimizer gateway URL is required');
    if (typeof this.fetchFn !== 'function') throw new Error('Fetch is unavailable');
    if (!Object.hasOwn(PROFILE_MAP, profile)) throw new Error(`Unsupported native profile: ${profile}`);
    const gatewayUrl = validateGatewayUrl(this.gatewayUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = { 'content-type': 'application/json' };
    if (this.gatewayToken) headers['x-optimizer-token'] = this.gatewayToken;
    try {
      const response = await this.fetchFn(gatewayUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          protocolVersion: 1,
          requestId: requestIdentifier(this.now),
          profile: PROFILE_MAP[profile],
          scope: 'self',
          clientId: this.clientId,
          targetClientIds: [],
          telemetry: facts
        })
      });
      if (!response?.ok) throw new Error(`Optimizer gateway request failed: ${response?.status || 'unknown'}`);
      const body = await readJson(response);
      return validateNativePlan(body?.plan || body, { now: this.now });
    } finally {
      clearTimeout(timer);
    }
  }

  async applyPlan(plan, { approvedActions = [], dryRun = false, allowAdmin = false } = {}) {
    const validatedPlan = validateNativePlan(plan, { now: this.now });
    const report = { dryRun, allowAdmin, normalUser: [], adminRequired: [], applied: [], wouldApply: [], rejected: [], skipped: [] };
    for (const rawAction of validatedPlan.actions) {
      let action;
      try {
        action = validateNativeAction(rawAction);
      } catch (error) {
        report.rejected.push({ action: rawAction, reason: error.message });
        continue;
      }
      const approved = approvalMatches(approvedActions, action);
      if (isDestructiveNativeAction(action) && !approved) {
        report.skipped.push({ action, reason: 'explicit approval required' });
        continue;
      }
      const adminRequired = this.adapter.requiresAdmin?.(action) === true;
      if (adminRequired) {
        report.adminRequired.push({ action, approved: allowAdmin });
        if (!allowAdmin) continue;
      } else {
        report.normalUser.push(action);
      }
      if (dryRun) {
        report.wouldApply.push(action);
        continue;
      }
      const result = await this.adapter.applyAction(action, {
        targetPid: this.targetPid,
        approvedBackgroundPids: this.approvedBackgroundPids,
        allowProcessStop: approved,
        approved
      });
      if (result?.ok === false) {
        report.rejected.push({ action, result, reason: result.reason || 'adapter rejected action' });
      } else {
        report.applied.push({ action, result });
      }
    }
    return report;
  }

  async optimize({ apply = false, profile = this.profile, approvedActions = [], dryRun = !apply, allowAdmin = false } = {}) {
    const facts = await this.collectFacts();
    const plan = await this.requestPlan(facts, { profile });
    const report = await this.applyPlan(plan, { approvedActions, dryRun: apply ? false : dryRun, allowAdmin });
    return { facts, plan, report };
  }
}
