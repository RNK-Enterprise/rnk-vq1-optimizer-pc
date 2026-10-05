/**
 * RNK Vortex System Optimizer
 * Copyright © 2025 Asgard Innovations / RNK™
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
 * PC browser host for the host-neutral optimizer client. The host owns
 * browser persistence and exposes only bounded, allow-listed runtime actions
 * to the embedding application.
 */

import { OptimizerClient } from './vq/client.js';
import { validateAction } from './vq/protocol.js';
import {
  asBackend,
  createBrowserStorage,
  withPersistence
} from './vq/persistence/index.js';
import { createBrowserEnvironment } from './browser-environment.js';

export const PC_STORAGE_KEY = 'rnk-vortex-system-optimizer.pc-state';

/**
 * Build the normalized environment for a PC browser host.
 *
 * @param {Object} [options] - Browser probe overrides for tests or embedding.
 * @returns {Promise<Object>} PC environment.
 */
export function createPcEnvironment(options = {}) {
  return createBrowserEnvironment({ ...options, host: 'pc' });
}

function createPcStorage(storage, storageKey) {
  if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') {
    return createBrowserStorage({ key: storageKey, storage });
  }
  return asBackend(storage) ?? createBrowserStorage({ key: storageKey });
}

/**
 * Base PC browser host. `runtimeAdapter.apply` is supplied by the embedding
 * application and receives validated actions only; no server value is ever
 * executed as code.
 */
export const PcBrowserHostBase = class PcBrowserHost {
  constructor({
    environment = null,
    storage,
    storageKey = PC_STORAGE_KEY,
    runtimeAdapter = null,
    navigatorRef,
    documentRef
  } = {}) {
    this.name = 'pc-browser-host';
    this.settings = {};
    this.disabled = new Set();
    this.runtime = {
      fpsCap: null,
      effectsBudget: null,
      animationBudget: null,
      networkBatch: null
    };
    this._staticEnvironment = environment;
    this._navigatorRef = navigatorRef;
    this._documentRef = documentRef;
    this._runtimeAdapter = runtimeAdapter && typeof runtimeAdapter.apply === 'function'
      ? runtimeAdapter
      : null;
    this._listeners = new Map();
    this._persistenceStorage = createPcStorage(storage, storageKey);
  }

  getPersistenceStorage() {
    return this._persistenceStorage;
  }

  on(event, listener) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(listener);
  }

  emit(event, data) {
    for (const listener of this._listeners.get(event) || []) {
      try {
        listener(data);
      } catch (error) {
        console.error(`rnk-vortex-system-optimizer | PC listener error for ${event}:`, error.message);
      }
    }
  }

  async getEnvironment() {
    const source = this._staticEnvironment ?? await createPcEnvironment({
      navigatorRef: this._navigatorRef,
      documentRef: this._documentRef
    });
    return {
      platform: {
        host: 'pc',
        type: source.platform?.type || 'pc',
        mobile: source.platform?.mobile === true
      },
      runtime: source.runtime || (source.platform?.mobile === true ? 'lite' : 'standard'),
      hardware: source.hardware || {},
      capabilities: source.capabilities || {},
      network: source.network || {}
    };
  }

  async _applyToRuntime(action, environment) {
    if (this._runtimeAdapter) await this._runtimeAdapter.apply(action, environment);
  }

  async applyAction(action, environment) {
    const validated = validateAction(action);
    await this._applyToRuntime(validated, environment);

    switch (validated.type) {
      case 'set-quality':
      case 'set-cache-size':
      case 'set-batch-size':
        this.settings[validated.key] = validated.value;
        return { ok: true };
      case 'set-fps-cap':
        this.runtime.fpsCap = validated.value;
        this.settings[validated.key] = validated.value;
        return { ok: true };
      case 'set-effect-budget':
        this.runtime.effectsBudget = validated.value;
        this.settings[validated.key] = validated.value;
        return { ok: true };
      case 'set-animation-budget':
        this.runtime.animationBudget = validated.value;
        this.settings[validated.key] = validated.value;
        return { ok: true };
      case 'set-network-batch':
        this.runtime.networkBatch = validated.value;
        this.settings[validated.key] = validated.value;
        return { ok: true };
      case 'set-runtime-variant':
        this.settings['runtime.variant'] = validated.key;
        return { ok: true };
      case 'enable-component':
        this.disabled.delete(validated.key);
        return { ok: true };
      case 'disable-component':
        this.disabled.add(validated.key);
        return { ok: true };
    }
  }

  getAppliedState() {
    return {
      settings: { ...this.settings },
      disabled: [...this.disabled],
      runtime: { ...this.runtime }
    };
  }
};

export const PcBrowserHost = withPersistence(PcBrowserHostBase);

let sharedClient = null;
let sharedHost = null;

/** Create a PC host and host-neutral optimizer client. */
export function createPcOptimizer({
  serverUrl = null,
  consent = true,
  clientOptions = {},
  hostOptions = {}
} = {}) {
  const host = new PcBrowserHost(hostOptions);
  const client = new OptimizerClient(host, { serverUrl, ...clientOptions });
  client.setConsent(consent !== false);
  return { host, client };
}

/** Install the process-local PC optimizer singleton. */
export function initPcOptimizer(options = {}) {
  const wired = createPcOptimizer(options);
  sharedHost = wired.host;
  sharedClient = wired.client;
  return wired;
}

export function getPcOptimizerClient() {
  return sharedClient;
}

export function getPcOptimizerHost() {
  return sharedHost;
}

export function resetPcOptimizerSingleton() {
  sharedClient = null;
  sharedHost = null;
}

export default PcBrowserHost;
