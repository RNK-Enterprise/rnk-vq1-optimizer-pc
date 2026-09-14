/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * Foundry Host Adapter for the VQ Optimizer Core
 *
 * Bridges the vendored host-neutral optimizer core (scripts/vq/) into the
 * Foundry module:
 *
 *   - `createFoundryEnvironment()` builds the shared environment shape from
 *     real browser APIs (cores, memory, battery, network, WASM/WebGL/WebGPU),
 *     fully guarded so it never throws;
 *   - `FoundryModuleHost` implements the two-method host contract
 *     (`getEnvironment` + `applyAction`) and persists applied optimizer
 *     settings through Foundry's `game.settings` (client-scoped, per user
 *     per world);
 *   - `createFoundryOptimizer()` wires host + OptimizerClient together.
 *
 * The host never executes anything beyond the protocol allow-list; the core
 * re-validates every action against shared bounds before it reaches here.
 */

import { OptimizerClient } from './vq/client.js';
import { createFoundryStorage, withPersistence, asBackend } from './vq/persistence/index.js';

const MODULE_ID = 'rnk-vortex-system-optimizer';

/** Foundry settings keys the optimizer may write via allow-listed actions. */
export const APPLIED_SETTINGS_KEY = 'vqAppliedSettings';

/**
 * Build the shared environment shape from real browser APIs. Every probe is
 * guarded; a missing or failing API degrades to null/false rather than
 * throwing, so detection works on any Foundry-capable browser.
 *
 * @returns {Promise<Object>} Environment (detector-compatible shape)
 */
export async function createFoundryEnvironment() {
  const nav = globalThis.navigator ?? {};

  // --- Platform ---
  const uaData = nav.userAgentData;
  const platformType = nav.platform || uaData?.platform || 'browser';
  const mobile = uaData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent ?? '');

  // --- Hardware ---
  let battery = null;
  try {
    if (typeof nav.getBattery === 'function') {
      const b = await nav.getBattery();
      battery = { charging: b.charging !== false };
    }
  } catch {
    battery = null;
  }
  const hardware = {
    cpu: { cores: Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null },
    memory: Number.isFinite(nav.deviceMemory) ? { total: nav.deviceMemory * 1024 ** 3 } : null,
    battery
  };

  // --- Capabilities ---
  let webgl = null;
  try {
    const canvas = globalThis.document?.createElement?.('canvas');
    if (canvas) {
      webgl = (canvas.getContext('webgl2') && '2.0') || (canvas.getContext('webgl') && '1.0') || null;
    }
  } catch {
    webgl = null;
  }
  let webgpu = false;
  try {
    webgpu = typeof nav.gpu?.requestAdapter === 'function' ? Boolean(await nav.gpu.requestAdapter()) : false;
  } catch {
    webgpu = false;
  }
  const capabilities = {
    wasm: typeof WebAssembly === 'object' && WebAssembly !== null,
    webgl,
    webgpu
  };

  // --- Network ---
  const conn = nav.connection ?? {};
  const network = {
    effectiveType: conn.effectiveType ?? null,
    saveData: conn.saveData === true
  };

  return {
    platform: { type: platformType, mobile },
    runtime: mobile ? 'lite' : 'standard',
    hardware,
    capabilities,
    network
  };
}

/**
 * Foundry module host base. Implements the host adapter contract and routes
 * allow-listed actions into an applied-settings record persisted through
 * `game.settings` (client scope, so every user keeps their own profile).
 */
export const FoundryModuleHostBase = class FoundryModuleHost {
  constructor({ environment = null, storage, storageOptions = {} } = {}) {
    this.name = 'foundry-module-host';
    this.serverUrl = null;
    // The applied-settings sink the mixin persists.
    this.settings = {};
    this.disabled = new Set();
    this.runtime = { effectsBudget: null, animationBudget: null, networkBatch: null };
    this._staticEnvironment = environment; // override for tests/simulation
    this._listeners = new Map();
    this._persistenceStorage =
      asBackend(storage) ?? createFoundryStorage({ namespace: MODULE_ID, key: APPLIED_SETTINGS_KEY, ...storageOptions });
  }

  getPersistenceStorage() {
    return this._persistenceStorage;
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
  }

  emit(event, data) {
    for (const fn of this._listeners.get(event) || []) {
      try {
        fn(data);
      } catch (error) {
        console.error(`${MODULE_ID} | host listener error for ${event}:`, error.message);
      }
    }
  }

  /**
   * Shared environment shape. Uses the injected static environment when
   * given (tests / simulation), otherwise probes real browser APIs.
   */
  async getEnvironment() {
    const source = this._staticEnvironment ?? (await createFoundryEnvironment());
    return {
      platform: { host: 'foundry', type: source.platform?.type || 'foundry', mobile: source.platform?.mobile === true },
      runtime: source.runtime || (isMobileEnvironment(source) ? 'lite' : 'standard'),
      hardware: source.hardware || {},
      capabilities: source.capabilities || {},
      network: source.network || {}
    };
  }

  /**
   * Apply one core-validated action to Foundry's bounded performance adapters.
   * The original action is also retained in the optimizer-owned state record.
   */
  async applyAction(action) {
    switch (action.type) {
      case 'set-quality':
      case 'set-cache-size':
      case 'set-batch-size':
        this.settings[action.key] = action.value;
        if (action.key === 'render.resolution' && Number.isFinite(globalThis.canvas?.app?.renderer?.resolution)) {
          globalThis.canvas.app.renderer.resolution = action.value;
        }
        return { ok: true };
      case 'set-fps-cap': {
        this.settings[action.key] = action.value;
        if (globalThis.canvas?.app?.ticker) globalThis.canvas.app.ticker.maxFPS = action.value;
        try {
          if (game?.settings?.settings?.has?.('core.maxFPS')) await game.settings.set('core', 'maxFPS', action.value);
        } catch {
          // Foundry versions without a writable core.maxFPS still retain the
          // bounded local cap for module consumers.
        }
        return { ok: true };
      }
      case 'set-effect-budget':
        this.runtime.effectsBudget = action.value;
        this.settings[action.key] = action.value;
        globalThis.__RNK_OPTIMIZER_EFFECT_BUDGET = action.value;
        return { ok: true };
      case 'set-animation-budget':
        this.runtime.animationBudget = action.value;
        this.settings[action.key] = action.value;
        globalThis.__RNK_OPTIMIZER_ANIMATION_BUDGET = action.value;
        return { ok: true };
      case 'set-network-batch':
        this.runtime.networkBatch = action.value;
        this.settings[action.key] = action.value;
        globalThis.__RNK_OPTIMIZER_NETWORK_BATCH = action.value;
        return { ok: true };
      case 'set-runtime-variant':
        this.settings['runtime.variant'] = action.key;
        return { ok: true };
      case 'enable-component':
        this.disabled.delete(action.key);
        return { ok: true };
      case 'disable-component':
        this.disabled.add(action.key);
        return { ok: true };
      default:
        throw new Error(`Unsupported action type: ${action.type}`);
    }
  }
};

/**
 * Foundry module host with durable persistence through `game.settings`.
 */
export const FoundryModuleHost = withPersistence(FoundryModuleHostBase);

/**
 * True when the environment looks like a mobile device; such hosts run the
 * lite runtime by default and get the mobile guardrails (render-distance
 * blocks, cache caps on metered connections).
 *
 * @param {Object} env - Shared environment shape
 * @returns {boolean}
 */
export function isMobileEnvironment(env) {
  return env?.platform?.mobile === true;
}

// --- Module-wide singleton ----------------------------------------------

let sharedClient = null;
let sharedHost = null;

/**
 * Create and install the module's optimizer client singleton. Safe to call
 * again; each call replaces the previous instance.
 *
 * @param {Object} [options]
 * @param {string|null} [options.serverUrl]
 * @param {boolean} [options.consent]
 * @param {Object} [options.clientOptions]
 * @param {Object} [options.hostOptions]
 * @returns {{ host: FoundryModuleHost, client: OptimizerClient }}
 */
export function initFoundryOptimizer({ serverUrl = null, consent = true, clientOptions = {}, hostOptions = {} } = {}) {
  const wired = createFoundryOptimizer({ serverUrl, clientOptions, hostOptions });
  sharedHost = wired.host;
  sharedClient = wired.client;
  sharedClient.setConsent(consent !== false);
  return wired;
}

/** The installed optimizer client (or null before init). */
export function getOptimizerClient() {
  return sharedClient;
}

/** The installed host adapter (or null before init). */
export function getOptimizerHost() {
  return sharedHost;
}

/**
 * Clear the module-wide optimizer singleton (tests, module re-init).
 */
export function resetOptimizerSingleton() {
  sharedClient = null;
  sharedHost = null;
}

/**
 * Wire a complete optimizer for the module: host + client, with an optional
 * server URL for the tandem stack.
 *
 * @param {Object} [options]
 * @param {string|null} [options.serverUrl] - VQ server plan endpoint
 * @param {Object} [options.clientOptions] - Extra OptimizerClient options
 * @param {Object} [options.hostOptions] - Extra host options (tests)
 * @returns {{ host: FoundryModuleHost, client: OptimizerClient }}
 */
export function createFoundryOptimizer({ serverUrl = null, clientOptions = {}, hostOptions = {} } = {}) {
  const host = new FoundryModuleHost(hostOptions);
  const client = new OptimizerClient(host, {
    serverUrl,
    ...clientOptions
  });
  return { host, client };
}

export default FoundryModuleHost;
