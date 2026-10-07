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
 *
 * Foundry GM Hub API client.
 * This module contains no VQ implementation: it sends bounded telemetry and
 * receives data-only plans through the Foundry-side gateway.
 */

import { PROTOCOL_VERSION, validateAction, DEFAULT_LIMITS } from './vq/protocol.js';

export const GM_HUB_PROTOCOL = 1;
export const OPTIMIZATION_PROFILES = ['power', 'balanced', 'performance', 'low-latency', 'battery-mobile'];
export const TARGET_SCOPES = ['self', 'all', 'selected'];
export const PLAN_ACTION_LIMIT = 24;

const DEFAULT_ENDPOINT = '/optimizer/v1';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requestId() {
  return `gm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorMessage(error) {
  return error?.message ?? String(error);
}

/** Validate the non-executable, data-only response returned by the gateway. */
export function validateGMPlan(plan, limits = DEFAULT_LIMITS) {
  if (!isPlainObject(plan)) throw new TypeError('GM plan must be an object');
  if (plan.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(`GM plan protocol mismatch: expected ${PROTOCOL_VERSION}, got ${plan.protocolVersion}`);
  }
  if (!OPTIMIZATION_PROFILES.includes(plan.profile)) {
    throw new Error(`Unknown optimization profile: ${plan.profile}`);
  }
  if (!TARGET_SCOPES.includes(plan.scope)) {
    throw new Error(`Unknown optimization scope: ${plan.scope}`);
  }
  if (!Array.isArray(plan.actions) || plan.actions.length > PLAN_ACTION_LIMIT) {
    throw new Error(`GM plan must contain 0-${PLAN_ACTION_LIMIT} actions`);
  }
  if (plan.expiresAt && !Number.isFinite(Date.parse(plan.expiresAt))) {
    throw new Error('GM plan expiresAt must be a valid timestamp');
  }
  if (plan.expiresAt && Date.now() >= Date.parse(plan.expiresAt)) {
    throw new Error('GM plan has expired');
  }

  const actions = plan.actions.map((action) => validateAction(action, limits));
  return {
    protocolVersion: plan.protocolVersion,
    planId: typeof plan.planId === 'string' ? plan.planId : requestId(),
    profile: plan.profile,
    scope: plan.scope,
    targetClientIds: Array.isArray(plan.targetClientIds)
      ? plan.targetClientIds.filter((id) => typeof id === 'string').slice(0, 128)
      : [],
    expiresAt: plan.expiresAt ?? null,
    actions,
    recommendations: Array.isArray(plan.recommendations)
      ? plan.recommendations.filter((item) => typeof item === 'string').slice(0, 32)
      : []
  };
}

/**
 * API-only gateway client. It never contains an optimization fallback or
 * decision engine; if VQ is unavailable, the request fails visibly.
 */
export class GMHubApi {
  constructor({ baseUrl = DEFAULT_ENDPOINT, fetchFn, token = null, gmAssertion = null, timeoutMs = 7000 } = {}) {
    this.baseUrl = String(baseUrl || DEFAULT_ENDPOINT).replace(/\/$/, '');
    this.fetchFn = fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.token = typeof token === 'string' && token.trim() ? token.trim() : null;
    this.gmAssertion = typeof gmAssertion === 'string' && gmAssertion.trim() ? gmAssertion.trim() : null;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 7000);
    if (!this.fetchFn) throw new TypeError('GMHubApi requires fetch');
  }

  _url(path) {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async _request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers['x-optimizer-token'] = this.token;
    if (this.gmAssertion) headers['x-foundry-gm-assertion'] = this.gmAssertion;
    try {
      const response = await this.fetchFn(this._url(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Gateway request failed: HTTP ${response.status}`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  getStatus() {
    return this._request('/status');
  }

  getClients() {
    return this._request('/clients');
  }

  sendTelemetry(clientId, telemetry) {
    return this._request('/telemetry', {
      method: 'POST',
      body: { protocolVersion: GM_HUB_PROTOCOL, requestId: requestId(), clientId, telemetry }
    });
  }

  async requestPlan({ profile = 'balanced', scope = 'self', targetClientIds = [], clientId, telemetry } = {}) {
    if (!OPTIMIZATION_PROFILES.includes(profile)) throw new Error(`Unknown optimization profile: ${profile}`);
    if (!TARGET_SCOPES.includes(scope)) throw new Error(`Unknown optimization scope: ${scope}`);
    const response = await this._request('/plan', {
      method: 'POST',
      body: {
        protocolVersion: GM_HUB_PROTOCOL,
        requestId: requestId(),
        profile,
        scope,
        targetClientIds,
        clientId,
        telemetry
      }
    });
    if (!response?.plan) throw new Error('Gateway response did not include a plan');
    return validateGMPlan(response.plan);
  }

  requestCleanupRecommendation({ clientId, telemetry, categories = [] } = {}) {
    return this._request('/cleanup/recommend', {
      method: 'POST',
      body: {
        protocolVersion: GM_HUB_PROTOCOL,
        requestId: requestId(),
        clientId,
        telemetry,
        categories: Array.isArray(categories) ? categories.slice(0, 16) : []
      }
    });
  }

  authorizeApply({ planId, scope, actionCount } = {}) {
    return this._request('/control/apply', {
      method: 'POST',
      body: {
        protocolVersion: GM_HUB_PROTOCOL,
        planId,
        scope,
        actionCount
      }
    });
  }
}

/**
 * Coordinates API calls, local safety validation and Foundry host actions.
 * VQ decides; this controller only validates and applies returned data.
 */
export class GMHubController {
  constructor({ api, host, telemetry, clientId = null, logFn = null, broadcastPlan = null } = {}) {
    if (!api || typeof api.requestPlan !== 'function') throw new TypeError('GMHubController requires GMHubApi');
    if (!host || typeof host.applyAction !== 'function') throw new TypeError('GMHubController requires a host');
    this.api = api;
    this.host = host;
    this.telemetry = telemetry;
    this.clientId = clientId || `client-${Math.random().toString(36).slice(2, 10)}`;
    this.logFn = typeof logFn === 'function' ? logFn : null;
    this.broadcastPlan = typeof broadcastPlan === 'function' ? broadcastPlan : null;
    this.state = { profile: 'balanced', scope: 'self', selectedClientIds: [], busy: false, lastPlan: null, lastApply: null };
  }

  log(message) {
    if (this.logFn) this.logFn(message);
  }

  async collectTelemetry() {
    if (!this.telemetry || typeof this.telemetry.snapshot !== 'function') return {};
    return this.telemetry.snapshot();
  }

  async preview({ profile = this.state.profile, scope = this.state.scope, targetClientIds = this.state.selectedClientIds } = {}) {
    if (this.state.busy) throw new Error('GM Hub request already running');
    this.state.busy = true;
    try {
      const telemetry = await this.collectTelemetry();
      const plan = await this.api.requestPlan({ profile, scope, targetClientIds, clientId: this.clientId, telemetry });
      this.state.profile = profile;
      this.state.scope = scope;
      this.state.selectedClientIds = [...targetClientIds];
      this.state.lastPlan = plan;
      this.log(`Plan received: ${plan.profile}, ${plan.actions.length} actions`);
      return plan;
    } finally {
      this.state.busy = false;
    }
  }

  async apply(plan = this.state.lastPlan, { broadcast = false } = {}) {
    if (!plan) throw new Error('No GM plan available');
    const safePlan = validateGMPlan(plan);
    if (typeof this.api.authorizeApply === 'function') {
      await this.api.authorizeApply({
        planId: safePlan.planId,
        scope: safePlan.scope,
        actionCount: safePlan.actions.length
      });
    }
    if (broadcast && safePlan.scope !== 'self') {
      if (!this.broadcastPlan) throw new Error('No Foundry plan transport is available');
      await this.broadcastPlan(safePlan);
      this.state.lastApply = { planId: safePlan.planId, applied: [], rejected: [], broadcast: true, at: Date.now() };
      this.log(`Plan broadcast: ${safePlan.actions.length} actions`);
      return this.state.lastApply;
    }
    const applied = [];
    const rejected = [];
    for (const action of safePlan.actions) {
      try {
        await this.host.applyAction(action);
        applied.push(action);
      } catch (error) {
        rejected.push({ action, reason: errorMessage(error) });
      }
    }
    this.state.lastApply = { planId: safePlan.planId, applied, rejected, at: Date.now() };
    this.log(`Plan applied: ${applied.length} applied, ${rejected.length} rejected`);
    return this.state.lastApply;
  }

  async reset() {
    this.host.settings = {};
    this.host.disabled?.clear?.();
    if (typeof this.host.saveNow === 'function') await this.host.saveNow();
    this.state.lastPlan = null;
    this.state.lastApply = null;
    this.log('Optimizer changes reset');
  }
}

export default GMHubApi;
