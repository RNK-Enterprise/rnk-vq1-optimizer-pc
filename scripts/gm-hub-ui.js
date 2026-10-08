/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
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
 * Foundry GM Performance Hub UI. VQ supplies plans through the gateway;
 * this file only collects telemetry, presents choices, validates responses,
 * and applies approved actions through the Foundry host adapter.
 */

import { GMHubApi, GMHubController, OPTIMIZATION_PROFILES, TARGET_SCOPES, validateGMPlan } from './gm-hub.js';
import { PerformanceTelemetry } from './telemetry.js';
import { FoundryActionHost } from './foundry-action-host.js';
import { SettingsManager } from './settings-manager.js';

const MODULE_ID = 'rnk-vortex-system-optimizer';
const ENDPOINT_SETTING = 'vqGatewayUrl';
let sharedHost = null;
let sharedTelemetry = null;

export function getGMHubHost() {
  if (!sharedHost) sharedHost = new FoundryActionHost();
  return sharedHost;
}

export function getGMHubTelemetry() {
  if (!sharedTelemetry) sharedTelemetry = new PerformanceTelemetry({ windowRef: globalThis });
  sharedTelemetry.start();
  return sharedTelemetry;
}

export function resetGMHubRuntime() {
  sharedTelemetry?.stop?.();
  sharedHost = null;
  sharedTelemetry = null;
}

function gatewayUrl() {
  try {
    const configured = game.settings.get(MODULE_ID, ENDPOINT_SETTING);
    if (typeof configured === 'string' && configured.trim()) return configured.trim();
  } catch { /* settings may not be registered during tests */ }
  return '/optimizer/v1';
}

function isGM() {
  return game?.user?.isGM === true;
}

function selectedIds(root) {
  return [...(root?.querySelectorAll?.('[data-client-id]:checked') || [])]
    .map((el) => el.dataset.clientId)
    .filter((id) => typeof id === 'string' && id.length > 0);
}

export class GMHubUI extends FormApplication {
  static get defaultOptions() {
    const merge = globalThis.foundry?.utils?.mergeObject ?? globalThis.mergeObject;
    return merge(super.defaultOptions, {
      id: 'rnk-gm-performance-hub',
      title: 'RNK Vortex | GM Performance Hub',
      template: `modules/${MODULE_ID}/templates/gm-hub.html`,
      width: 1040,
      height: 720,
      resizable: true,
      classes: ['rnk-gm-performance-hub'],
      closeOnSubmit: false,
      submitOnChange: false
    });
  }

  constructor(object = {}, options = {}) {
    super(object, options);
    this.logs = [];
    this.clients = [];
    this.plan = null;
    this.telemetryTimer = null;
    this.api = new GMHubApi({ baseUrl: gatewayUrl() });
    this.controller = new GMHubController({
      api: this.api,
      host: getGMHubHost(),
      telemetry: getGMHubTelemetry(),
      logFn: (message) => this.log(message),
      broadcastPlan: (plan) => this.broadcastPlan(plan)
    });
    this.telemetryTimer = setInterval(() => {
      this.sendTelemetry().catch(() => {});
    }, 10000);
    this.telemetryTimer.unref?.();
  }

  log(message) {
    this.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
    if (this.logs.length > 200) this.logs = this.logs.slice(-200);
    this._renderHub();
  }

  async getData() {
    let status = { gateway: 'offline', cluster: { mode: 'OFFLINE', unitsHealthy: 0, unitsTotal: 2 } };
    try {
      status = await this.api.getStatus();
    } catch (error) {
      status.error = error?.message || String(error);
    }
    try {
      const result = await this.api.getClients();
      this.clients = Array.isArray(result.clients) ? result.clients : [];
    } catch (error) {
      status.clientsError = error?.message || String(error);
    }
    const telemetry = await this.controller.collectTelemetry();
    return {
      status,
      clients: this.clients,
      telemetry,
      profiles: OPTIMIZATION_PROFILES.map((value) => ({ value, selected: value === this.controller.state.profile })),
      scopes: TARGET_SCOPES.map((value) => ({ value, selected: value === this.controller.state.scope })),
      selectedProfile: this.controller.state.profile,
      selectedScope: this.controller.state.scope,
      plan: this.plan ? JSON.stringify(this.plan, null, 2) : null,
      logs: this.logs.join('\n'),
      isGM: isGM()
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.[0] ?? html;
    if (!root?.addEventListener) return;
    root.addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'preview') return this.preview();
      if (action === 'apply') return this.apply();
      if (action === 'broadcast') return this.apply(true);
      if (action === 'cleanup') return this.cleanupRecommendation();
      if (action === 'reset') return this.reset();
      if (action === 'refresh') return this.refresh();
      if (action === 'close') return this.close();
      if (OPTIMIZATION_PROFILES.includes(action)) {
        this.controller.state.profile = action;
        this._renderHub();
      }
    });
    root.addEventListener('change', (event) => {
      const target = event.target;
      if (target?.name === 'scope') {
        this.controller.state.scope = TARGET_SCOPES.includes(target.value) ? target.value : 'self';
        this._renderHub();
      }
    });
  }

  async preview() {
    if (!isGM()) return ui.notifications.warn('GM only.');
    const root = this.element?.[0] ?? this.element;
    const scope = this.controller.state.scope;
    const targetClientIds = scope === 'selected' ? selectedIds(root) : [];
    if (scope === 'selected' && targetClientIds.length === 0) {
      return ui.notifications.warn('Select at least one client.');
    }
    try {
      this.plan = await this.controller.preview({
        profile: this.controller.state.profile,
        scope,
        targetClientIds
      });
      this.log(`Preview ready from ${this.plan.sourceUnits?.join(' + ') || 'VQ gateway'}`);
      this._renderHub();
    } catch (error) {
      this.log(`Preview failed: ${error?.message || String(error)}`);
      ui.notifications.error('VQ plan request failed. Check the gateway and VQ units.');
    }
  }

  async apply(broadcast = false) {
    if (!this.plan) return ui.notifications.warn('Preview a VQ plan first.');
    try {
      const result = await this.controller.apply(this.plan, { broadcast });
      if (broadcast) {
        ui.notifications.info('VQ plan sent to the selected Foundry clients.');
      } else {
        ui.notifications.info(`Applied ${result.applied.length} VQ actions to this client.`);
      }
      this._renderHub();
    } catch (error) {
      this.log(`Apply failed: ${error?.message || String(error)}`);
      ui.notifications.error('VQ plan could not be applied.');
    }
  }

  async broadcastPlan(plan) {
    const safePlan = validateGMPlan(plan);
    if (!game.socket?.emit) throw new Error('Foundry socket is unavailable');
    game.socket.emit(`module.${MODULE_ID}`, {
      type: 'gm-plan',
      plan: safePlan,
      senderId: game.user.id,
      sentAt: Date.now()
    });
  }

  async cleanupRecommendation() {
    try {
      const recommendation = await this.api.requestCleanupRecommendation({
        clientId: this.controller.clientId,
        telemetry: await this.controller.collectTelemetry(),
        categories: ['chat', 'combats', 'compendiums']
      });
      this.log(`Cleanup recommendation received: ${JSON.stringify(recommendation.recommendations || [])}`);
      ui.notifications.info('Cleanup recommendations received; no documents were changed.');
    } catch (error) {
      this.log(`Cleanup recommendation failed: ${error?.message || String(error)}`);
      ui.notifications.error('Cleanup recommendation request failed.');
    }
  }

  async reset() {
    await this.controller.reset();
    this.plan = null;
    this.log('Local VQ changes reset.');
    this._renderHub();
  }

  async sendTelemetry() {
    const telemetry = await this.controller.collectTelemetry();
    return this.api.sendTelemetry(this.controller.clientId, telemetry);
  }

  async refresh() {
    this.api = new GMHubApi({ baseUrl: gatewayUrl() });
    this.controller.api = this.api;
    await this.render(true);
  }

  async close(options) {
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
    getGMHubTelemetry().stop();
    return super.close(options);
  }

  _renderHub() {
    const root = this.element?.[0] ?? this.element;
    const log = root?.querySelector?.('[data-role="log"]');
    if (log) log.textContent = this.logs.join('\n');
    const plan = root?.querySelector?.('[data-role="plan"]');
    if (plan) plan.textContent = this.plan ? JSON.stringify(this.plan, null, 2) : 'No plan previewed.';
  }
}

export async function applyIncomingGMPlan(plan, clientId = null) {
  const safePlan = validateGMPlan(plan);
  const targetIds = safePlan.targetClientIds;
  if (safePlan.scope === 'selected' && (!clientId || !targetIds.includes(clientId))) {
    return { applied: [], rejected: [], skipped: true, reason: 'client not targeted' };
  }
  if (safePlan.scope === 'all' || safePlan.scope === 'self' || targetIds.includes(clientId)) {
    const controller = new GMHubController({
      api: { requestPlan: async () => safePlan },
      host: getGMHubHost(),
      telemetry: getGMHubTelemetry(),
      clientId: clientId || undefined
    });
    return controller.apply(safePlan);
  }
  return { applied: [], rejected: [], skipped: true, reason: 'client not targeted' };
}

export default GMHubUI;
