/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * Tests for the VQ Foundry host adapter, factories, settings wiring and
 * the optimizer-UI VQ integration.
 */

import {
  createFoundryEnvironment,
  FoundryModuleHost,
  FoundryModuleHostBase,
  createFoundryOptimizer,
  initFoundryOptimizer,
  getOptimizerClient,
  getOptimizerHost,
  resetOptimizerSingleton,
  isMobileEnvironment,
  APPLIED_SETTINGS_KEY
} from '../scripts/vq-foundry-host.js';
import { OptimizerClient } from '../scripts/vq/client.js';
import { OptimizerUI, nowISO } from '../scripts/optimizer-ui.js';
import { SettingsManager } from '../scripts/settings-manager.js';

// localStorage-like fake (in-memory map).
function fakeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v))
  };
}

// game.settings-shaped fake with Foundry registration semantics.
function fakeFoundrySettings() {
  const registered = new Set();
  const values = new Map();
  return {
    register(ns, key) {
      registered.add(`${ns}.${key}`);
    },
    async get(ns, key) {
      const k = `${ns}.${key}`;
      if (!registered.has(k) && !values.has(k)) {
        throw new Error(`Setting ${k} does not exist`);
      }
      return values.has(k) ? values.get(k) : null;
    },
    async set(ns, key, value) {
      values.set(`${ns}.${key}`, value);
    }
  };
}

describe('createFoundryEnvironment', () => {
  test('probes real browser APIs and normalizes the shape', async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        platform: 'Win32',
        userAgent: 'Mozilla/5.0 Desktop',
        hardwareConcurrency: 8,
        deviceMemory: 16,
        getBattery: async () => ({ charging: true }),
        connection: { effectiveType: '4g', saveData: false }
      },
      configurable: true
    });

    try {
      const env = await createFoundryEnvironment();
      expect(env.platform.type).toBe('Win32');
      expect(env.platform.mobile).toBe(false);
      expect(env.hardware.cpu.cores).toBe(8);
      expect(env.hardware.memory.total).toBe(16 * 1024 ** 3);
      expect(env.hardware.battery).toEqual({ charging: true });
      expect(env.network.effectiveType).toBe('4g');
      expect(env.capabilities.wasm).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
  });

  test('detects mobile via userAgentData and degrades missing APIs', async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgentData: { mobile: true, platform: 'Android' },
        userAgent: 'Mozilla/5.0 (Android) Mobile',
        getBattery: () => {
          throw new Error('no battery');
        }
      },
      configurable: true
    });

    try {
      const env = await createFoundryEnvironment();
      expect(env.platform.mobile).toBe(true);
      expect(env.platform.type).toBe('Android');
      expect(env.hardware.cpu.cores).toBeNull();
      expect(env.hardware.memory).toBeNull();
      expect(env.hardware.battery).toBeNull();
      expect(env.runtime).toBe('lite');
      expect(env.network.effectiveType).toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
  });

  test('falls back to UA sniffing without userAgentData', async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' },
      configurable: true
    });

    try {
      const env = await createFoundryEnvironment();
      expect(env.platform.mobile).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
  });

  test('detects WebGL2, WebGPU adapters and discharging battery', async () => {
    const originalNavigator = globalThis.navigator;
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Desktop',
        getBattery: async () => ({ charging: false }),
        gpu: { requestAdapter: async () => ({}) }
      },
      configurable: true
    });
    globalThis.document = {
      createElement: () => ({
        getContext: (type) => (type === 'webgl2' ? {} : null)
      })
    };

    try {
      const env = await createFoundryEnvironment();
      expect(env.capabilities.webgl).toBe('2.0');
      expect(env.capabilities.webgpu).toBe(true);
      expect(env.hardware.battery).toEqual({ charging: false });
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
      globalThis.document = originalDocument;
    }
  });

  test('reports no WebGL and no WebGPU adapter when unavailable', async () => {
    const originalNavigator = globalThis.navigator;
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Desktop',
        gpu: { requestAdapter: async () => null }
      },
      configurable: true
    });
    globalThis.document = {
      createElement: () => ({
        getContext: () => null
      })
    };

    try {
      const env = await createFoundryEnvironment();
      expect(env.capabilities.webgl).toBeNull();
      expect(env.capabilities.webgpu).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
      globalThis.document = originalDocument;
    }
  });

  test('handles a completely absent navigator and defaults the platform', async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });

    try {
      const env = await createFoundryEnvironment();
      expect(env.platform.type).toBe('browser'); // default platform
      expect(env.platform.mobile).toBe(false);
      expect(env.hardware.cpu.cores).toBeNull();
      expect(env.capabilities.wasm).toBe(true); // WebAssembly exists in node
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
  });

  test('uses WebGL1 when WebGL2 is unavailable', async () => {
    const originalNavigator = globalThis.navigator;
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Desktop' }, configurable: true });
    globalThis.document = {
      createElement: () => ({
        getContext: (type) => (type === 'webgl' ? {} : null)
      })
    };

    try {
      const env = await createFoundryEnvironment();
      expect(env.capabilities.webgl).toBe('1.0');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
      globalThis.document = originalDocument;
    }
  });

  test('survives probing APIs that throw', async () => {
    const originalNavigator = globalThis.navigator;
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Desktop',
        getBattery: () => {
          throw new Error('battery probe failed');
        },
        gpu: {
          requestAdapter: () => {
            throw new Error('gpu probe failed');
          }
        }
      },
      configurable: true
    });
    globalThis.document = {
      createElement: () => {
        throw new Error('canvas creation failed');
      }
    };

    try {
      const env = await createFoundryEnvironment();
      expect(env.hardware.battery).toBeNull();
      expect(env.capabilities.webgpu).toBe(false);
      expect(env.capabilities.webgl).toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
      globalThis.document = originalDocument;
    }
  });
});

describe('isMobileEnvironment', () => {
  test('reads the platform flag', () => {
    expect(isMobileEnvironment({ platform: { mobile: true } })).toBe(true);
    expect(isMobileEnvironment({ platform: { mobile: false } })).toBe(false);
    expect(isMobileEnvironment({})).toBe(false);
  });
});

describe('FoundryModuleHost', () => {
  test('implements the two-method contract and applies allow-listed actions', async () => {
    const host = new FoundryModuleHost();
    const env = await host.getEnvironment();
    expect(env.platform.host).toBe('foundry');

    await host.applyAction({ type: 'set-quality', key: 'render.distance', value: 8 });
    await host.applyAction({ type: 'set-cache-size', key: 'cache.size', value: 512 });
    await host.applyAction({ type: 'set-batch-size', key: 'batch.size', value: 32 });
    await host.applyAction({ type: 'set-runtime-variant', key: 'lite' });
    await host.applyAction({ type: 'disable-component', key: 'wasm-particle-effects' });
    await host.applyAction({ type: 'enable-component', key: 'wasm-particle-effects' });

    expect(host.settings['render.distance']).toBe(8);
    expect(host.settings['cache.size']).toBe(512);
    expect(host.settings['batch.size']).toBe(32);
    expect(host.settings['runtime.variant']).toBe('lite');
    expect(host.disabled.has('wasm-particle-effects')).toBe(false);
  });

  test('rejects unsupported action types', async () => {
    const host = new FoundryModuleHost();
    await expect(host.applyAction({ type: 'run-shell', command: 'rm -rf /' })).rejects.toThrow(
      'Unsupported action type'
    );
  });

  test('persists applied state through game.settings and restores it', async () => {
    const foundrySettings = fakeFoundrySettings();
    global.game.settings = foundrySettings;

    const first = new FoundryModuleHost();
    await first.applyAction({ type: 'set-quality', key: 'render.distance', value: 6 });
    await first.applyAction({ type: 'set-runtime-variant', key: 'wasm' });
    await first.applyAction({ type: 'disable-component', key: 'heavy-fx' });

    const second = new FoundryModuleHost();
    expect(await second.whenPersistedReady()).toBe(true);
    expect(second.settings['render.distance']).toBe(6);
    expect(second.settings['runtime.variant']).toBe('wasm');
    expect(second.disabled.has('heavy-fx')).toBe(true);
  });

  test('uses the static environment override when provided', async () => {
    const host = new FoundryModuleHost({
      environment: {
        platform: { type: 'test', mobile: true },
        runtime: 'wasm',
        hardware: { cpu: { cores: 2 } },
        capabilities: { wasm: true },
        network: { effectiveType: '2g' }
      }
    });
    const env = await host.getEnvironment();
    expect(env.platform.host).toBe('foundry');
    expect(env.platform.type).toBe('test');
    expect(env.runtime).toBe('wasm');
    expect(env.runtime).not.toBe('lite'); // explicit runtime wins over mobile default
  });

  test('mobile environment defaults to lite runtime', async () => {
    const host = new FoundryModuleHost({
      environment: { platform: { type: 'browser', mobile: true } }
    });
    const env = await host.getEnvironment();
    expect(env.runtime).toBe('lite');
  });

  test('desktop environment defaults to standard runtime', async () => {
    const host = new FoundryModuleHost({
      environment: { platform: { type: 'browser', mobile: false } }
    });
    const env = await host.getEnvironment();
    expect(env.runtime).toBe('standard');
  });

  test('emits and receives lifecycle events', async () => {
    const host = new FoundryModuleHost();
    const seen = [];
    host.on('test-event', (d) => seen.push(d));
    host.emit('test-event', { ok: 1 });
    host.emit('test-event', { ok: 2 });
    expect(seen).toEqual([{ ok: 1 }, { ok: 2 }]);
  });

  test('supports multiple listeners for the same event', async () => {
    const host = new FoundryModuleHost();
    const seen = [];
    host.on('multi', (d) => seen.push(`first:${d.n}`));
    host.on('multi', (d) => seen.push(`second:${d.n}`)); // same event again
    host.emit('multi', { n: 1 });
    expect(seen).toEqual(['first:1', 'second:1']);
  });

  test('listener errors never break the host', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const host = new FoundryModuleHost();
    host.on('boom', () => {
      throw new Error('listener exploded');
    });
    expect(() => host.emit('boom', {})).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('storage injection overrides the default backend', async () => {
    const ls = fakeLocalStorage();
    const host = new FoundryModuleHost({ storage: ls });
    await host.applyAction({ type: 'set-quality', key: 'render.distance', value: 4 });
    expect(host.getPersistenceInfo().storageType).toBe('browser');
  });

  test('degrades to memory persistence without a Foundry API', async () => {
    // Remove the Foundry settings API entirely (setup.js provides a mock).
    const savedSettings = global.game.settings;
    global.game.settings = undefined;
    try {
      const host = new FoundryModuleHost();
      await host.whenPersistedReady();
      expect(host.getPersistenceInfo().storageType).toBe('memory');
      await host.applyAction({ type: 'set-cache-size', key: 'cache.size', value: 256 });
      expect(host.settings['cache.size']).toBe(256);
    } finally {
      global.game.settings = savedSettings;
    }
  });

  test('base class exposes the storage hook for the mixin', () => {
    const host = new FoundryModuleHostBase();
    expect(typeof host.getPersistenceStorage()).toBe('object');
  });
});

describe('createFoundryOptimizer', () => {
  test('wires host and client together', () => {
    const { host, client } = createFoundryOptimizer({ serverUrl: 'https://x/plan' });
    expect(host).toBeInstanceOf(FoundryModuleHost);
    expect(client).toBeInstanceOf(OptimizerClient);
    expect(client.host).toBe(host);
    expect(client.options.serverUrl).toBe('https://x/plan');
  });

  test('passes client options through', () => {
    const { client } = createFoundryOptimizer({
      clientOptions: { timeoutMs: 1234 }
    });
    expect(client.options.timeoutMs).toBe(1234);
  });

  test('works with no arguments at all', () => {
    const wired = createFoundryOptimizer();
    expect(wired.host).toBeInstanceOf(FoundryModuleHost);
    expect(wired.client.options.serverUrl).toBeNull();

    const shared = initFoundryOptimizer();
    expect(shared.client._state.consent).toBe(true); // default consent granted
  });
});

describe('initFoundryOptimizer singleton', () => {
  test('installs and replaces the shared client and host', () => {
    const first = initFoundryOptimizer({ serverUrl: 'https://a/plan', consent: false });
    expect(getOptimizerClient()).toBe(first.client);
    expect(getOptimizerHost()).toBe(first.host);
    expect(first.client._state.consent).toBe(false);

    const second = initFoundryOptimizer({ serverUrl: 'https://b/plan' });
    expect(getOptimizerClient()).toBe(second.client);
    expect(second.client._state.consent).toBe(true);
  });
});

describe('SettingsManager VQ registrations', () => {
  test('registers all VQ settings exactly once', async () => {
    // register() records into the map like real Foundry so the
    // isSettingRegistered guards behave realistically.
    game.settings.register = jest.fn((ns, key) => {
      game.settings.settings.set(`${ns}.${key}`, {});
    });
    game.settings.registerMenu = jest.fn((ns, key) => {
      game.settings.menus.set(`${ns}.${key}`, {});
    });
    game.settings.settings = new Map();
    game.settings.menus = new Map();

    await SettingsManager.registerAll(OptimizerUI);
    const firstCalls = game.settings.register.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    const registeredKeys = game.settings.register.mock.calls.map((c) => c[1]);
    expect(registeredKeys).toEqual(expect.arrayContaining(['vqServerUrl', 'vqConsent', 'vqApplyActions', 'vqMobileGuardrails']));

    await SettingsManager.registerAll(OptimizerUI);
    expect(game.settings.register.mock.calls.length).toBe(firstCalls);
  });

  test('getOptionsFromSettings reads the cleanup options', () => {
    game.settings.get = jest.fn(() => true);
    const options = SettingsManager.getOptionsFromSettings();
    expect(options.doCleanupChat).toBe(true);
    expect(options.doCorePerformanceTweaks).toBe(true);
  });
});

describe('OptimizerUI VQ integration', () => {
  function makeUI() {
    const ui = new OptimizerUI();
    ui._renderLog = jest.fn();
    return ui;
  }

  test('getData includes the VQ env summary and consent', async () => {
    initFoundryOptimizer({
      hostOptions: {
        environment: {
          platform: { type: 'browser', mobile: false },
          hardware: { cpu: { cores: 8 } },
          capabilities: { wasm: true, webgl: '2.0', webgpu: false },
          network: { effectiveType: '4g', saveData: false }
        }
      }
    });
    game.settings.get = jest.fn(() => true);

    const ui = makeUI();
    const data = await ui.getData();

    expect(data.vqConsent).toBe(true);
    expect(data.vqEnv.device).toBe('Desktop');
    expect(data.vqEnv.runtime).toBe('standard');
    expect(data.vqEnv.cores).toBe(8);
    expect(data.vqEnv.webgl).toBe('2.0');
    expect(data.vqEnv.wasm).toBe('yes');
    expect(data.vqEnv.network).toBe('4g');
    expect(data.vqEnv.planSource).toBe('not run');
    expect(data.vqEnv.appliedCount).toBe(0);
  });

  test('getData without an initialized optimizer reports not-initialized', async () => {
    resetOptimizerSingleton();
    const ui = makeUI();
    const data = await ui.getData();
    expect(data.vqEnv.device).toBe('unknown');
    expect(data.vqEnv.runtime).toBe('not initialized');
  });

  test('getData reports applied count and last plan source', async () => {
    const wired = initFoundryOptimizer({
      hostOptions: {
        environment: { platform: { type: 'browser', mobile: false } }
      }
    });
    await wired.host.applyAction({ type: 'set-quality', key: 'render.distance', value: 4 });
    wired.client._state.lastReport = { source: 'server', at: Date.now() };

    const ui = makeUI();
    const data = await ui.getData();
    expect(data.vqEnv.planSource).toBe('server');
    expect(data.vqEnv.appliedCount).toBe(1);
  });

  test('getData renders mobile summary with disabled components and no report', async () => {
    const wired = initFoundryOptimizer({
      hostOptions: {
        environment: { platform: { type: 'browser', mobile: true } }
      }
    });
    await wired.host.applyAction({ type: 'disable-component', key: 'wasm-particle-effects' });
    await wired.host.applyAction({ type: 'disable-component', key: 'heavy-shadows' });

    const ui = makeUI();
    const data = await ui.getData();
    expect(data.vqEnv.device).toBe('Mobile');
    expect(data.vqEnv.runtime).toBe('lite');
    expect(data.vqEnv.planSource).toBe('not run');
    expect(data.vqEnv.appliedCount).toBe(2);
  });

  test('getData falls back when the consent setting read fails', async () => {
    initFoundryOptimizer({});
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'vqConsent') throw new Error('not registered');
      return true;
    });

    const ui = makeUI();
    const data = await ui.getData();
    expect(data.vqConsent).toBe(true); // default granted
  });

  test('getData handles a report without a finite timestamp', async () => {
    const wired = initFoundryOptimizer({});
    wired.client._state.lastReport = { source: 'local', at: 'not-a-number' };

    const ui = makeUI();
    const data = await ui.getData();
    expect(data.vqEnv.planSource).toBe('local');
  });

  test('vqConsent change persists and updates the live client', async () => {
    const wired = initFoundryOptimizer({});
    game.settings.set = jest.fn().mockResolvedValue(true);

    const ui = makeUI();
    ui._setSetting = jest.fn().mockResolvedValue(undefined);

    const changeHandler = jest.fn();
    const root = {
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') changeHandler.mockImplementation(handler);
      })
    };
    ui.activateListeners([root]);

    changeHandler({ target: { name: 'vqConsent', checked: false } });
    expect(ui._setSetting).toHaveBeenCalledWith('vqConsent', false);
    expect(wired.client._state.consent).toBe(false);

    changeHandler({ target: { name: 'vqConsent', checked: true } });
    expect(ui._setSetting).toHaveBeenCalledWith('vqConsent', true);
    expect(wired.client._state.consent).toBe(true);
  });

  test('click handler routes vqCycle and vqReset actions', async () => {
    initFoundryOptimizer({});
    const ui = makeUI();
    ui._onVQCycle = jest.fn();
    ui._onVQReset = jest.fn();

    const clickHandler = jest.fn();
    const root = {
      addEventListener: jest.fn((event, handler) => {
        if (event === 'click') clickHandler.mockImplementation(handler);
      })
    };
    ui.activateListeners([root]);

    clickHandler({ target: { closest: () => ({ dataset: { action: 'vqCycle' } }) } });
    clickHandler({ target: { closest: () => ({ dataset: { action: 'vqReset' } }) } });

    expect(ui._onVQCycle).toHaveBeenCalled();
    expect(ui._onVQReset).toHaveBeenCalled();
  });

  test('_onVQCycle runs a full local cycle and logs the report', async () => {
    const wired = initFoundryOptimizer({
      hostOptions: {
        environment: {
          platform: { type: 'browser', mobile: true },
          capabilities: { wasm: false, webgpu: false },
          network: { effectiveType: '2g', saveData: true }
        }
      }
    });
    wired.client.options.serverUrl = null; // force local safe mode

    const ui = makeUI();
    ui.element = null; // no button to disable

    await ui._onVQCycle();

    const log = ui._logLines.join('\n');
    expect(log).toContain('VQ env:');
    expect(log).toContain('VQ cycle: source=local');
    expect(log).toContain('VQ applied:');
    expect(global.ui.notifications.info).toHaveBeenCalled();
  });

  test('_onVQCycle logs server-unavailable and action events', async () => {
    const wired = initFoundryOptimizer({
      hostOptions: {
        environment: {
          platform: { type: 'browser', mobile: true },
          capabilities: { wasm: false, webgpu: false },
          network: { effectiveType: '2g', saveData: true }
        }
      }
    });
    wired.client.options.serverUrl = 'https://unreachable.test/plan';
    wired.client.options.fetchFn = async () => {
      throw new Error('ECONNREFUSED');
    };

    const ui = makeUI();
    ui.element = null;

    await ui._onVQCycle();

    const log = ui._logLines.join('\n');
    expect(log).toContain('VQ: server unreachable - local safe mode');
    expect(log).toContain('VQ cycle: source=local');
  });

  test('_onVQCycle guards missing client and busy state', async () => {
    resetOptimizerSingleton();

    const ui = makeUI();
    await ui._onVQCycle();
    expect(global.ui.notifications.error).toHaveBeenCalledWith('VQ optimizer is not initialized.');

    initFoundryOptimizer({});
    const busyClient = getOptimizerClient();
    busyClient._state.busy = true;
    await ui._onVQCycle();
    expect(global.ui.notifications.warn).toHaveBeenCalledWith('VQ optimizer cycle already running.');
  });

  test('_onVQCycle handles run errors', async () => {
    const wired = initFoundryOptimizer({
      hostOptions: { environment: { platform: { type: 'browser', mobile: false } } }
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    wired.client.run = async () => {
      throw new Error('boom');
    };

    const ui = makeUI();
    ui.element = null;
    await ui._onVQCycle();

    expect(global.ui.notifications.error).toHaveBeenCalledWith('VQ optimizer cycle failed. See console.');
    expect(ui._logLines.join('\n')).toContain('VQ cycle failed: boom');
    consoleSpy.mockRestore();
  });

  test('_onVQCycle re-enables the button afterwards', async () => {
    initFoundryOptimizer({
      hostOptions: { environment: { platform: { mobile: false } } }
    });
    const ui = makeUI();
    const btn = { disabled: false };
    ui.element = [{ querySelector: jest.fn().mockReturnValue(btn) }];

    await ui._onVQCycle();
    expect(btn.disabled).toBe(false);
  });

  test('_onVQCycle logs failed and rejected actions', async () => {
    const wired = initFoundryOptimizer({
      hostOptions: {
        environment: {
          platform: { type: 'browser', mobile: true },
          capabilities: { wasm: false, webgpu: false },
          network: { effectiveType: '2g', saveData: true }
        }
      }
    });
    wired.client.options.serverUrl = null;
    // Make every apply blow up so 'action-failed' fires.
    wired.host.applyAction = async () => {
      throw new Error('apply blew up');
    };

    const ui = makeUI();
    ui.element = null;
    await ui._onVQCycle();

    expect(ui._logLines.join('\n')).toContain('VQ failed: set-cache-size cache.size - apply blew up');
  });

  test('_onVQCycle logs actions rejected by local bounds', async () => {
    const wired = initFoundryOptimizer({
      hostOptions: {
        environment: { platform: { type: 'browser', mobile: false } }
      }
    });
    wired.client.options.serverUrl = 'https://test/plan';
    wired.client.options.fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        plan: {
          protocolVersion: 1,
          actions: [
            { type: 'set-quality', key: 'render.distance', value: 9999 }, // out of bounds
            { type: 'set-batch-size', key: 'batch.size', value: 32 } // valid
          ]
        }
      })
    });

    const ui = makeUI();
    ui.element = null;
    await ui._onVQCycle();

    const log = ui._logLines.join('\n');
    expect(log).toContain('VQ rejected: set-quality render.distance');
    expect(log).toContain('VQ applied: set-batch-size batch.size 32');
    expect(log).toContain('VQ cycle: source=server applied=1 skipped=1');
  });

  test('_onVQCycle logs env with webgl present and a non-finite plan time', async () => {
    const wired = initFoundryOptimizer({
      hostOptions: {
        environment: {
          platform: { type: 'browser', mobile: false },
          capabilities: { wasm: true, webgl: '1.0', webgpu: false },
          network: { effectiveType: '4g', saveData: false }
        }
      }
    });
    wired.client.options.serverUrl = null;
    wired.client.run = async () => ({ source: 'local', applied: [], skipped: 0, at: null });

    const ui = makeUI();
    ui.element = null;
    await ui._onVQCycle();

    const log = ui._logLines.join('\n');
    expect(log).toContain('webgl=1.0');
    expect(log).not.toContain('VQ plan time:');
  });

  test('_setVQConsent works without an installed client', async () => {
    resetOptimizerSingleton();
    const ui = makeUI();
    ui._setSetting = jest.fn().mockResolvedValue(undefined);

    await ui._setVQConsent(false);
    expect(ui._setSetting).toHaveBeenCalledWith('vqConsent', false);
  });

  test('_onVQReset without an installed host still confirms and notifies', async () => {
    resetOptimizerSingleton();
    global.Dialog.confirm = jest.fn().mockResolvedValue(true);

    const ui = makeUI();
    await ui._onVQReset();
    expect(ui._logLines.join('\n')).toContain('VQ: applied settings reset');
  });

  test('_onVQReset clears host state and persists an empty record', async () => {
    const wired = initFoundryOptimizer({
      hostOptions: { environment: { platform: { type: 'browser', mobile: false } } }
    });
    await wired.host.applyAction({ type: 'set-quality', key: 'render.distance', value: 8 });

    const ui = makeUI();
    ui.element = null;
    await ui._onVQReset();

    expect(wired.host.settings).toEqual({});
    expect(wired.host.disabled.size).toBe(0);
    expect(ui._logLines.join('\n')).toContain('VQ: applied settings reset');
    expect(global.ui.notifications.info).toHaveBeenCalledWith('VQ optimizer settings reset');
  });

  test('_onVQReset respects a canceled confirm and survives persist errors', async () => {
    const wired = initFoundryOptimizer({
      hostOptions: { environment: { platform: { type: 'browser', mobile: false } } }
    });
    await wired.host.applyAction({ type: 'set-cache-size', key: 'cache.size', value: 128 });

    const ui = makeUI();

    // Canceled confirm leaves state untouched.
    global.Dialog.confirm = jest.fn().mockResolvedValue(false);
    await ui._onVQReset();
    expect(wired.host.settings['cache.size']).toBe(128);

    // Persist failure is logged, not thrown.
    global.Dialog.confirm = jest.fn().mockResolvedValue(true);
    wired.host.saveNow = async () => {
      throw new Error('disk full');
    };
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    await ui._onVQReset();
    expect(consoleSpy).toHaveBeenCalled();
    expect(wired.host.settings).toEqual({});
    consoleSpy.mockRestore();
  });

  test('_buildVQEnvSummary renders defaults for a minimal environment', async () => {
    initFoundryOptimizer({});
    const host = getOptimizerHost();
    host._staticEnvironment = {
      hardware: {},
      capabilities: { webgpu: true } // no platform, runtime, cores, webgl, wasm, network
    };

    const ui = makeUI();
    const summary = await ui._buildVQEnvSummary(host, null); // no client either

    expect(summary.device).toBe('Desktop'); // missing platform falls back
    expect(summary.runtime).toBe('standard'); // missing runtime falls back
    expect(summary.network).toBe('unknown'); // missing effectiveType falls back
    expect(summary.cores).toBe('?'); // missing cores falls back
    expect(summary.webgpu).toBe('yes');
    expect(summary.webgl).toBe('none');
    expect(summary.wasm).toBe('no');
    expect(summary.planSource).toBe('not run');
  });

  test('_buildVQEnvSummary marks data saver on metered connections', async () => {
    initFoundryOptimizer({
      hostOptions: {
        environment: { platform: { mobile: true }, network: { effectiveType: '3g', saveData: true } }
      }
    });
    const ui = makeUI();
    const summary = await ui._buildVQEnvSummary(getOptimizerHost(), getOptimizerClient());
    expect(summary.network).toBe('3g (data saver)');
  });

  test('_onVQCycle survives undefined event payloads, non-Error throws, and floods', async () => {
    const wired = initFoundryOptimizer({
      hostOptions: { environment: { platform: { mobile: false } } }
    });
    wired.client.options.serverUrl = null;
    wired.client.run = async () => {
      // Emit degenerate payloads through the real host contract first.
      wired.host.emit('server-unavailable', undefined);
      wired.host.emit('action-applied', undefined);
      wired.host.emit('action-failed', undefined);
      wired.host.emit('action-rejected', undefined);
      throw 'non-error failure'; // no .message property
    };

    const ui = makeUI();
    ui.element = [{ querySelector: () => ({ disabled: false }) }];
    ui._logLines = Array.from({ length: 305 }, (_, i) => `old ${i}`); // force flood trim

    await ui._onVQCycle();

    const log = ui._logLines.join('\n');
    expect(log).toContain('VQ: server unreachable - local safe mode (unknown)');
    expect(log).toContain('VQ cycle failed: non-error failure');
    expect(ui._logLines.length).toBeLessThanOrEqual(300);
  });

  test('_buildVQEnvSummary falls back on every missing field of a stub environment', async () => {
    initFoundryOptimizer({});
    const host = getOptimizerHost();
    host.getEnvironment = async () => ({}); // nothing provided at all

    const ui = makeUI();
    const summary = await ui._buildVQEnvSummary(host, null);

    expect(summary.device).toBe('Desktop');
    expect(summary.runtime).toBe('standard');
    expect(summary.network).toBe('unknown');
    expect(summary.cores).toBe('?');
    expect(summary.webgl).toBe('none');
    expect(summary.webgpu).toBe('no');
    expect(summary.wasm).toBe('no');
    expect(summary.planSource).toBe('not run');
  });

  test('_onVQCycle survives a degenerate environment shape', async () => {
    const wired = initFoundryOptimizer({});
    wired.client.options.serverUrl = null;
    wired.host.getEnvironment = async () => ({}); // no platform/caps/network at all

    const ui = makeUI();
    ui.element = null;
    await ui._onVQCycle();

    expect(ui._logLines.join('\n')).toContain('VQ env:');
  });

  test('nowISO helper is used for VQ log lines', () => {
    expect(nowISO()).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });
});

describe('OptimizerUI reporting fallbacks (legacy paths)', () => {
  function makeUI() {
    const ui = new OptimizerUI();
    ui._renderLog = jest.fn();
    return ui;
  }

  test('_onDryRun tolerates a report without changes/notes/wouldDelete fields', async () => {
    game.user.isGM = true;
    const ui = makeUI();
    ui.element = null;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { enabled: true }, combats: { enabled: true } },
        compendiums: { enabled: true },
        performance: { enabled: true } // no `changes` key at all
        // no `notes` key at all
      })
    };

    await ui._onDryRun();
    expect(ui._logLines.join('\n')).toContain('Dry Run: no core performance changes needed');
  });

  test('_onDryRun renders a string failure without a message property', async () => {
    game.user.isGM = true;
    const ui = makeUI();
    ui.element = null;
    ui._service = {
      dryRun: jest.fn().mockRejectedValue('plain string failure')
    };
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    await ui._onDryRun();
    consoleSpy.mockRestore();

    expect(ui._logLines.join('\n')).toContain('Dry Run failed: plain string failure');
  });

  test('_onDryRun skips empty notes arrays', async () => {
    game.user.isGM = true;
    const ui = makeUI();
    ui.element = null;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: {}, combats: {} },
        compendiums: { enabled: false },
        performance: { enabled: false },
        notes: [] // present but empty
      })
    };

    await ui._onDryRun();
    expect(ui._logLines.join('\n')).not.toContain('Note:');
  });  test('_onRun logs defaults when report fields are missing', async () => {
    game.user.isGM = true;
    const ui = makeUI();
    const btn = { disabled: false };
    ui.element = [{ querySelector: jest.fn().mockReturnValue(btn) }];
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: {}, combats: {} } // wouldDelete missing -> 0
      }),      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: {}, combats: {} },
        compendiums: { indexedPacks: 3 }, // indexedDocs missing -> docs~=0
        performance: {} // no applied, no rafFPS
      })
    };

    const savedMemory = global.performance.memory;
    delete global.performance.memory; // heap lines are skipped
    try {
      await ui._onRun();
    } finally {
      global.performance.memory = savedMemory;
    }

    const log = ui._logLines.join('\n');
    expect(log).toContain('Done: deleted chat=0, combats=0');
    expect(log).toContain('Done: indexed packs=3, docs~=0');
    expect(log).not.toContain('Heap:');
    expect(log).not.toContain('Observed RAF FPS');
    expect(btn.disabled).toBe(false); // re-enabled in finally
  });  test('_onRun cancels on declined confirmation and survives non-Error throws', async () => {
    game.user.isGM = true;
    const ui = makeUI();
    ui.element = null;

    // Declined confirmation
    global.Dialog.confirm = jest.fn().mockResolvedValue(false);
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 3 }, combats: { wouldDelete: 0 } }
      })
    };
    await ui._onRun();
    expect(ui._logLines.join('\n')).toContain('Canceled.');

    // Non-Error throw inside optimize
    global.Dialog.confirm = jest.fn().mockResolvedValue(true);
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({ cleanup: { chat: {}, combats: {} } }),
      optimize: jest.fn().mockRejectedValue('plain string failure')
    };
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    await ui._onRun();
    consoleSpy.mockRestore();
    expect(ui._logLines.join('\n')).toContain('Failed: plain string failure');

    // Failure after a long session trims the log back to the cap
    ui._logLines = Array.from({ length: 305 }, (_, i) => `old ${i}`);
    const consoleSpy2 = jest.spyOn(console, 'error').mockImplementation();
    await ui._onRun();
    consoleSpy2.mockRestore();
    expect(ui._logLines.length).toBeLessThanOrEqual(300);
  });

  test('PerformanceTweaks.apply records non-Error failures as strings', async () => {
    const { PerformanceTweaks } = await import('../scripts/performance-tweaks.js');
    game.settings.settings.set('core.maxFPS', { type: Number });
    game.settings.get = jest.fn((ns, key) => (ns === 'core' && key === 'maxFPS' ? 60 : undefined));
    game.settings.set = jest.fn().mockRejectedValue('plain string failure');
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    try {
      const tweaks = new PerformanceTweaks();
      const report = { performance: {} };
      await tweaks.apply(report);
      expect(report.performance.failed?.[0]?.error).toBe('plain string failure');
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('_onRun stops logging when heap metrics exist but are non-finite', async () => {
    game.user.isGM = true;
    const ui = makeUI();
    ui.element = null;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({ cleanup: { chat: {}, combats: {} } }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: {}, combats: {} },
        compendiums: {},
        performance: { rafFPS: Number.NaN } // non-finite -> not logged
      })
    };
    const savedMemory = global.performance.memory;
    global.performance.memory = { usedJSHeapSize: Number.NaN }; // non-finite
    try {
      await ui._onRun();
    } finally {
      global.performance.memory = savedMemory;
    }

    const log = ui._logLines.join('\n');
    expect(log).not.toContain('Heap:');
    expect(log).not.toContain('Observed RAF FPS');
  });

  test('_measureRAFFPS resolves null without requestAnimationFrame', async () => {
    const { OptimizerCore } = await import('../scripts/optimizer-core.js');
    const optimizer = new OptimizerCore();
    const savedRAF = global.requestAnimationFrame;
    delete global.requestAnimationFrame;
    try {
      await expect(optimizer._measureRAFFPS()).resolves.toBeNull();
    } finally {
      global.requestAnimationFrame = savedRAF;
    }
  });

  test('_setSetting surfaces non-Error failures without crashing', async () => {
    const ui = makeUI();
    ui._setSetting = OptimizerUI.prototype._setSetting; // restore real impl
    game.settings.set = jest.fn().mockRejectedValue('plain string failure');
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    await ui._setSetting('doCleanupChat', false);
    consoleSpy.mockRestore();

    expect(global.ui.notifications.error).toHaveBeenCalledWith('Failed to save setting: doCleanupChat');
  });
});
