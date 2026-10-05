/**
 * PC browser host contract tests.
 * Copyright (c) Lisa's Dungeon
 */

import {
  createPcEnvironment,
  PcBrowserHost,
  PcBrowserHostBase,
  createPcOptimizer,
  initPcOptimizer,
  getPcOptimizerClient,
  getPcOptimizerHost,
  resetPcOptimizerSingleton,
  PC_STORAGE_KEY
} from '../scripts/pc-host.js';
import { OptimizerClient } from '../scripts/vq/client.js';
import { createBrowserEnvironment } from '../scripts/browser-environment.js';

function fakeStorage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = String(next);
    },
    read: () => value
  };
}

function desktopNavigator(overrides = {}) {
  return {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 Desktop',
    hardwareConcurrency: 12,
    deviceMemory: 32,
    getBattery: async () => ({ charging: true }),
    connection: { effectiveType: '4g', saveData: false },
    ...overrides
  };
}

describe('createPcEnvironment', () => {
  test('shared browser probe handles defaults, null references, and regex mobile detection', async () => {
    const originalNavigator = globalThis.navigator;
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'navigator', { value: null, configurable: true });
    globalThis.document = undefined;

    try {
      const defaults = await createBrowserEnvironment();
      const nullRefs = await createBrowserEnvironment({ navigatorRef: null, documentRef: null });
      const regexMobile = await createBrowserEnvironment({ navigatorRef: { userAgent: 'Android Mobile' } });
      expect(defaults.platform).toEqual({ host: 'browser', type: 'browser', mobile: false });
      expect(nullRefs.platform.type).toBe('browser');
      expect(regexMobile.platform.mobile).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
      globalThis.document = originalDocument;
    }
  });

  test('normalizes desktop capabilities and hardware', async () => {
    const env = await createPcEnvironment({
      navigatorRef: desktopNavigator(),
      documentRef: { createElement: () => ({ getContext: (type) => type === 'webgl2' ? {} : null }) }
    });

    expect(env.platform).toEqual({ host: 'pc', type: 'Win32', mobile: false });
    expect(env.runtime).toBe('standard');
    expect(env.hardware.cpu.cores).toBe(12);
    expect(env.hardware.memory.total).toBe(32 * 1024 ** 3);
    expect(env.hardware.battery).toEqual({ charging: true });
    expect(env.capabilities).toEqual({ wasm: true, webgl: '2.0', webgpu: false });
    expect(env.network).toEqual({ effectiveType: '4g', saveData: false });
  });

  test('uses mobile and WebGL1 fallbacks', async () => {
    const env = await createPcEnvironment({
      navigatorRef: {
        userAgentData: { mobile: true, platform: 'Linux' },
        userAgent: 'Android Mobile',
        connection: { saveData: true },
        getBattery: async () => ({ charging: false })
      },
      documentRef: { createElement: () => ({ getContext: (type) => type === 'webgl' ? {} : null }) }
    });

    expect(env.platform.mobile).toBe(true);
    expect(env.platform.type).toBe('Linux');
    expect(env.runtime).toBe('lite');
    expect(env.hardware.cpu.cores).toBeNull();
    expect(env.hardware.memory).toBeNull();
    expect(env.hardware.battery).toEqual({ charging: false });
    expect(env.capabilities.webgl).toBe('1.0');
    expect(env.network).toEqual({ effectiveType: null, saveData: true });
  });

  test('fails closed when optional browser APIs are absent or throw', async () => {
    const env = await createPcEnvironment({
      navigatorRef: {
        userAgent: 'Desktop',
        getBattery: () => { throw new Error('battery unavailable'); },
        gpu: { requestAdapter: () => { throw new Error('gpu unavailable'); } }
      },
      documentRef: { createElement: () => { throw new Error('canvas unavailable'); } }
    });

    expect(env.platform.type).toBe('browser');
    expect(env.hardware.battery).toBeNull();
    expect(env.capabilities.webgl).toBeNull();
    expect(env.capabilities.webgpu).toBe(false);
    expect(env.network).toEqual({ effectiveType: null, saveData: false });
  });

  test('reports a browser with no WebGL contexts', async () => {
    const env = await createPcEnvironment({
      navigatorRef: { userAgent: 'Desktop' },
      documentRef: { createElement: () => ({ getContext: () => null }) }
    });
    expect(env.capabilities.webgl).toBeNull();
  });

  test('supports no navigator or document references', async () => {
    const env = await createPcEnvironment({ navigatorRef: undefined, documentRef: undefined });
    const defaults = await createPcEnvironment();
    expect(env.platform.host).toBe('pc');
    expect(env.platform.mobile).toBe(false);
    expect(env.capabilities.wasm).toBe(true);
    expect(defaults.platform.host).toBe('pc');
  });
});

describe('PcBrowserHost', () => {
  test('applies every allow-listed action and exposes a state snapshot', async () => {
    const calls = [];
    const host = new PcBrowserHost({
      environment: { platform: { type: 'Win32', mobile: false } },
      runtimeAdapter: { apply: async (action, environment) => calls.push({ action, environment }) }
    });

    expect(await host.getEnvironment()).toEqual({
      platform: { host: 'pc', type: 'Win32', mobile: false },
      runtime: 'standard',
      hardware: {},
      capabilities: {},
      network: {}
    });
    await host.applyAction({ type: 'set-quality', key: 'render.distance', value: 8 });
    await host.applyAction({ type: 'set-cache-size', key: 'cache.size', value: 512 });
    await host.applyAction({ type: 'set-batch-size', key: 'batch.size', value: 32 });
    await host.applyAction({ type: 'set-fps-cap', key: 'fps.cap', value: 120 });
    await host.applyAction({ type: 'set-effect-budget', key: 'effects.budget', value: 80 });
    await host.applyAction({ type: 'set-animation-budget', key: 'animation.budget', value: 70 });
    await host.applyAction({ type: 'set-network-batch', key: 'network.batch', value: 16 });
    await host.applyAction({ type: 'set-runtime-variant', key: 'wasm' });
    await host.applyAction({ type: 'disable-component', key: 'heavy-effects' });
    await host.applyAction({ type: 'enable-component', key: 'heavy-effects' });

    expect(calls).toHaveLength(10);
    expect(host.getAppliedState()).toEqual({
      settings: {
        'render.distance': 8,
        'cache.size': 512,
        'batch.size': 32,
        'fps.cap': 120,
        'effects.budget': 80,
        'animation.budget': 70,
        'network.batch': 16,
        'runtime.variant': 'wasm'
      },
      disabled: [],
      runtime: { fpsCap: 120, effectsBudget: 80, animationBudget: 70, networkBatch: 16 }
    });
  });

  test('uses desktop fallback runtime and ignores an invalid runtime adapter', async () => {
    const host = new PcBrowserHost({ environment: { platform: { mobile: false } }, runtimeAdapter: {} });
    expect((await host.getEnvironment()).runtime).toBe('standard');
    await host.applyAction({ type: 'set-quality', key: 'render.resolution', value: 1 });
    expect(host.settings['render.resolution']).toBe(1);

    const mobileHost = new PcBrowserHost({ environment: { platform: { mobile: true } } });
    expect((await mobileHost.getEnvironment()).runtime).toBe('lite');

    const detectedHost = new PcBrowserHost();
    expect((await detectedHost.getEnvironment()).platform.host).toBe('pc');
  });

  test('rejects invalid actions and propagates runtime adapter failures', async () => {
    const host = new PcBrowserHost({ runtimeAdapter: { apply: async () => { throw new Error('adapter failed'); } } });
    await expect(host.applyAction({ type: 'run-shell', command: 'bad' })).rejects.toThrow('Unsupported optimizer action');
    await expect(host.applyAction({ type: 'set-quality', key: 'render.distance', value: 8 })).rejects.toThrow('adapter failed');
    expect(host.settings).toEqual({});
  });

  test('emits events, tolerates listener errors, and supports multiple listeners', () => {
    const errors = jest.spyOn(console, 'error').mockImplementation();
    const host = new PcBrowserHost();
    const seen = [];
    host.on('event', (data) => seen.push(`one:${data.value}`));
    host.on('event', (data) => seen.push(`two:${data.value}`));
    host.on('event', () => { throw new Error('listener failed'); });
    expect(() => host.emit('event', { value: 3 })).not.toThrow();
    expect(seen).toEqual(['one:3', 'two:3']);
    expect(errors).toHaveBeenCalled();
    expect(() => host.emit('unobserved', {})).not.toThrow();
    errors.mockRestore();
  });

  test('persists state through an injected browser store', async () => {
    const storage = fakeStorage();
    const first = new PcBrowserHost({ storage, storageKey: 'pc-test-state' });
    await first.applyAction({ type: 'set-quality', key: 'render.distance', value: 6 });
    await first.applyAction({ type: 'disable-component', key: 'heavy-fx' });

    const second = new PcBrowserHost({ storage, storageKey: 'pc-test-state' });
    expect(await second.whenPersistedReady()).toBe(true);
    expect(second.settings['render.distance']).toBe(6);
    expect(second.disabled.has('heavy-fx')).toBe(true);
    expect(second.getPersistenceInfo().storageType).toBe('browser');
  });

  test('accepts a backend, defaults to the PC key, and falls back to memory', async () => {
    const records = [];
    const backend = {
      type: 'test-backend',
      hydrate: async () => records.at(-1) ?? null,
      persist: async (record) => { records.push(record); return true; }
    };
    const fromBackend = new PcBrowserHost({ storage: backend });
    await fromBackend.applyAction({ type: 'set-cache-size', key: 'cache.size', value: 256 });
    expect(fromBackend.getPersistenceInfo().storageType).toBe('test-backend');
    expect(records.at(-1).settings['cache.size']).toBe(256);
    expect(PC_STORAGE_KEY).toBe('rnk-vortex-system-optimizer.pc-state');

    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    try {
      const memoryHost = new PcBrowserHost();
      await memoryHost.whenPersistedReady();
      expect(memoryHost.getPersistenceInfo().storageType).toBe('memory');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: originalStorage, configurable: true });
    }
  });

  test('base class exposes its persistence backend', () => {
    expect(new PcBrowserHostBase().getPersistenceStorage()).toBeDefined();
  });
});

describe('PC optimizer factories', () => {
  beforeEach(() => resetPcOptimizerSingleton());

  test('creates a client and applies consent', () => {
    const wired = createPcOptimizer({ serverUrl: '/optimizer/v1/plan', consent: false });
    const defaultWired = createPcOptimizer();
    expect(wired.host).toBeInstanceOf(PcBrowserHost);
    expect(wired.client).toBeInstanceOf(OptimizerClient);
    expect(wired.client.host).toBe(wired.host);
    expect(wired.client.options.serverUrl).toBe('/optimizer/v1/plan');
    expect(wired.client._state.consent).toBe(false);
    expect(defaultWired.client.options.serverUrl).toBeNull();
  });

  test('runs a server plan through the PC host contract', async () => {
    let request = null;
    const wired = createPcOptimizer({
      serverUrl: '/optimizer/v1/plan',
      hostOptions: {
        environment: {
          platform: { type: 'Win32', mobile: false },
          capabilities: { wasm: true, webgpu: true },
          network: { effectiveType: '4g', saveData: false }
        }
      },
      clientOptions: {
        fetchFn: async (_url, options) => {
          request = JSON.parse(options.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              plan: {
                protocolVersion: 1,
                actions: [{ type: 'set-fps-cap', key: 'fps.cap', value: 120 }]
              }
            })
          };
        }
      }
    });

    const report = await wired.client.run();
    expect(request.platform).toBe('pc');
    expect(report).toMatchObject({ platform: 'pc', source: 'server', skipped: 0 });
    expect(wired.host.runtime.fpsCap).toBe(120);
  });

  test('installs and replaces the process-local singleton', () => {
    const first = initPcOptimizer({ consent: false });
    expect(getPcOptimizerClient()).toBe(first.client);
    expect(getPcOptimizerHost()).toBe(first.host);
    expect(first.client._state.consent).toBe(false);

    const second = initPcOptimizer();
    expect(getPcOptimizerClient()).toBe(second.client);
    expect(second.client._state.consent).toBe(true);

    resetPcOptimizerSingleton();
    expect(getPcOptimizerClient()).toBeNull();
    expect(getPcOptimizerHost()).toBeNull();
  });
});
