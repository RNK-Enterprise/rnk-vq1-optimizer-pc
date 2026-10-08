/**
 * PC client, protocol, and persistence tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { OptimizerClient } from '../scripts/vq/client.js';
import {
  ALLOWED_ACTIONS,
  DEFAULT_LIMITS,
  validateAction,
  validatePlan
} from '../scripts/vq/protocol.js';
import {
  asBackend,
  createBrowserStorage,
  createMemoryStorage,
  filterPersistableSettings,
  isPersistableSetting,
  validatePersistedState
} from '../scripts/vq/persistence/storage.js';
import { withPersistence } from '../scripts/vq/persistence/mixin.js';

const action = { type: 'set-quality', key: 'render.distance', value: 8 };
const environment = {
  platform: { host: 'pc', type: 'Linux', mobile: false },
  runtime: 'standard',
  hardware: { cpu: { cores: 8 }, memory: { total: 16 * 1024 ** 3 }, battery: { charging: false } },
  network: { effectiveType: '4g', saveData: false },
  capabilities: { wasm: true, webgl: '2.0', webgpu: true }
};

function makeHost(overrides = {}) {
  return {
    getEnvironment: jest.fn(async () => environment),
    applyAction: jest.fn(async () => ({ ok: true })),
    emit: jest.fn(),
    ...overrides
  };
}

describe('PC protocol validation', () => {
  test('validates action families and normalizes plan versions', () => {
    expect(ALLOWED_ACTIONS).toHaveLength(10);
    expect(validateAction(action)).not.toBe(action);
    expect(validateAction({ type: 'set-runtime-variant', key: 'standard' })).toEqual({ type: 'set-runtime-variant', key: 'standard' });
    expect(validatePlan({ actions: [action] })).toEqual(expect.objectContaining({ protocolVersion: 1, actions: [action] }));
  });

  test('rejects malformed actions and plans without widening limits', () => {
    expect(() => validateAction(null)).toThrow('object');
    expect(() => validateAction([])).toThrow('Unsupported');
    expect(() => validateAction({ type: 'nope' })).toThrow('Unsupported');
    expect(() => validateAction({ type: 'set-quality' })).toThrow('string key');
    expect(() => validateAction({ ...action, value: Number.NaN })).toThrow('finite');
    expect(() => validateAction({ ...action, key: 'unknown' })).toThrow('No limits');
    expect(() => validateAction({ ...action, value: DEFAULT_LIMITS['render.distance'].max + 1 })).toThrow('outside limits');
    expect(() => validateAction({ type: 'disable-component' })).toThrow('string key');
    expect(() => validateAction({ type: 'set-runtime-variant', key: 'unknown' })).toThrow('Unknown runtime');
    expect(() => validatePlan(null)).toThrow('object');
    expect(() => validatePlan({})).toThrow('actions array');
    expect(() => validatePlan({ protocolVersion: 2, actions: [] })).toThrow('mismatch');
  });
});

describe('PC persistence storage', () => {
  test('filters managed settings and validates hostile records', () => {
    expect(isPersistableSetting('runtime.variant', 'standard')).toBe(true);
    expect(isPersistableSetting('runtime.variant', 'bad')).toBe(false);
    expect(isPersistableSetting('cache.size', 512)).toBe(true);
    expect(isPersistableSetting('cache.size', Number.NaN)).toBe(false);
    expect(isPersistableSetting('cache.size', 99999)).toBe(false);
    expect(filterPersistableSettings(null)).toEqual({});
    expect(filterPersistableSettings({ ...action, 'cache.size': 512, nope: 1 })).toEqual({ 'cache.size': 512 });

    const disabled = Array.from({ length: 65 }, (_, index) => `component-${index}`);
    const valid = validatePersistedState({ version: 1, settings: { 'cache.size': 512 }, disabled: [...disabled, 'component-0', '', 4] });
    expect(valid.settings).toEqual({ 'cache.size': 512 });
    expect(valid.disabled).toHaveLength(64);
    expect(validatePersistedState(null)).toBeNull();
    expect(validatePersistedState([])).toBeNull();
    expect(validatePersistedState({ version: 99 })).toBeNull();
    expect(validatePersistedState({ version: 1, settings: [] })).toBeNull();
    expect(validatePersistedState({ version: 1, disabled: {} })).toBeNull();
    expect(validatePersistedState({ version: 1, settings: {} })).toEqual({ settings: {}, disabled: [] });
    expect(validatePersistedState({ version: 1, disabled: ['', 'valid'] })).toEqual({ settings: {}, disabled: ['valid'] });
    expect(validatePersistedState(new Proxy({}, { get: () => { throw new Error('corrupt'); } }))).toBeNull();
  });

  test('supports memory, browser, raw, backend, corrupt, and failing storage', async () => {
    const memory = createMemoryStorage();
    expect(await memory.hydrate()).toBeNull();
    await expect(memory.persist({ version: 1 })).resolves.toBe(true);
    await expect(memory.hydrate()).resolves.toEqual({ version: 1 });
    expect(asBackend(null)).toBeNull();
    expect(asBackend({})).toBeNull();
    expect(asBackend(memory)).toBe(memory);

    let raw = null;
    const storage = { getItem: jest.fn(() => raw), setItem: jest.fn((_key, value) => { raw = value; }) };
    const browser = createBrowserStorage({ key: 'pc', storage });
    await expect(browser.hydrate()).resolves.toBeNull();
    await expect(browser.persist({ version: 1 })).resolves.toBe(true);
    await expect(browser.hydrate()).resolves.toEqual({ version: 1 });
    raw = '{bad';
    await expect(browser.hydrate()).resolves.toBeNull();
    raw = '';
    await expect(browser.hydrate()).resolves.toBeNull();
    const failing = createBrowserStorage({ storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } });
    await expect(failing.persist({ version: 1 })).resolves.toBe(false);
    expect(asBackend(storage).type).toBe('browser');
    expect(createBrowserStorage({ storage: null }).type).toBe('memory');
    expect(createBrowserStorage().type).toBe('memory');
  });
});

describe('PC persistence mixin', () => {
  class BaseHost {
    constructor() {
      this.settings = {};
      this.disabled = new Set();
    }

    getPersistenceStorage() {
      return null;
    }

    async applyAction(next) {
      this.settings[next.key] = next.value;
      return { ok: true };
    }

    async getEnvironment() {
      return environment;
    }
  }

  test('handles no storage and successful hydration, migration, apply, and save', async () => {
    const EmptyHost = withPersistence(BaseHost);
    const empty = new EmptyHost();
    await expect(empty.whenPersistedReady()).resolves.toBe(false);
    await expect(empty.saveNow()).resolves.toBe(false);
    expect(empty.getPersistenceInfo()).toEqual(expect.objectContaining({ enabled: false, hydrated: false }));

    class BareHost {
      constructor() {
        this.settings = null;
        this.disabled = null;
      }
    }
    const BarePersistentHost = withPersistence(BareHost);
    const bare = new BarePersistentHost();
    expect(bare.settings).toEqual({});
    expect(bare.disabled).toBeInstanceOf(Set);
    expect(await bare.saveNow()).toBe(false);

    const backend = {
      type: 'test',
      hydrate: jest.fn().mockResolvedValue({ version: 1, settings: { 'cache.size': 200 }, disabled: ['low-effects'] }),
      persist: jest.fn().mockResolvedValue(true)
    };
    const PersistentHost = withPersistence(BaseHost, { storage: backend, migrations: [(record) => ({ ...record })] });
    const host = new PersistentHost();
    await expect(host.whenPersistedReady()).resolves.toBe(true);
    expect(host.settings['cache.size']).toBe(200);
    expect(host.disabled.has('low-effects')).toBe(true);
    await expect(host.getEnvironment()).resolves.toEqual(environment);
    await expect(host.applyAction({ key: 'cache.size', value: 300 })).resolves.toEqual({ ok: true });
    await expect(host.saveNow()).resolves.toBe(true);
    expect(backend.persist).toHaveBeenCalled();
    expect(host.getPersistenceInfo()).toEqual(expect.objectContaining({ enabled: true, storageType: 'test', hydrated: true, lastError: null }));
  });

  test('fails closed for bad hydration, migration, and persistence failures', async () => {
    const badBackend = { hydrate: jest.fn().mockResolvedValue({ version: 9 }), persist: jest.fn().mockResolvedValue(false) };
    const BadHost = withPersistence(BaseHost, { storage: badBackend, migrations: [(record) => null] });
    const bad = new BadHost();
    await expect(bad.whenPersistedReady()).resolves.toBe(false);
    await expect(bad.saveNow()).resolves.toBe(false);
    expect(bad.getPersistenceInfo().lastError).toBe('Storage backend rejected persist');

    const throwing = { type: 'throwing', hydrate: jest.fn().mockRejectedValue(new Error('read failed')), persist: jest.fn() };
    const ThrowingHost = withPersistence(BaseHost, { storage: throwing });
    const failed = new ThrowingHost();
    await expect(failed.whenPersistedReady()).resolves.toBe(false);
    expect(failed.getPersistenceInfo().lastError).toBe('read failed');

    const persistThrowing = { hydrate: jest.fn().mockResolvedValue(null), persist: jest.fn().mockRejectedValue(new Error('write failed')) };
    const PersistThrowingHost = withPersistence(BaseHost, { storage: persistThrowing });
    const writeFailed = new PersistThrowingHost();
    await expect(writeFailed.saveNow()).resolves.toBe(false);
    expect(writeFailed.getPersistenceInfo().lastError).toBe('write failed');
  });
});

describe('PC optimizer client', () => {
  test('validates hosts, emits safely, collects bounded metrics, and uses local fallback', async () => {
    expect(() => new OptimizerClient()).toThrow('requires a host');
    expect(() => new OptimizerClient({})).toThrow('getEnvironment');
    const host = makeHost();
    const client = new OptimizerClient(host);
    expect(client._collectMetrics(environment)).toEqual(expect.objectContaining({ platform: { host: 'pc', mobile: false } }));
    expect(client._collectMetrics({})).toEqual(expect.objectContaining({ platform: { host: 'unknown', mobile: false } }));
    const noEmitClient = new OptimizerClient({ getEnvironment: async () => ({}), applyAction: async () => ({ ok: true }) });
    expect(() => noEmitClient._emit('event', {})).not.toThrow();
    client.setConsent(false);
    expect(client._collectMetrics(environment)).toEqual({});
    const truncated = new OptimizerClient(host, { maxMetricsBytes: 1 });
    expect(truncated._collectMetrics(environment)).toEqual({ truncated: true });
    client._emit('event', {});
    host.emit.mockImplementation(() => { throw new Error('listener'); });
    expect(() => client._emit('event', {})).not.toThrow();
    client._state.busy = true;
    await expect(client.run()).rejects.toThrow('already running');
    client._state.busy = false;

    const originalFetch = global.fetch;
    try {
      global.fetch = undefined;
      expect(new OptimizerClient(host).options.fetchFn).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }

    const localHost = makeHost({ getEnvironment: jest.fn(async () => ({ ...environment, platform: { host: 'pc', mobile: true }, network: { saveData: true }, capabilities: { wasm: false, webgpu: false } })) });
    const local = new OptimizerClient(localHost);
    const report = await local.run({ useServer: false });
    expect(report.source).toBe('local');
    expect(report.applied).toHaveLength(3);
    expect(local.getLastPlan()).toBeTruthy();
    expect(local.getLastReport()).toBe(report);
    expect(local.isBusy()).toBe(false);
    expect(local._localFallbackPlan({}).actions).toEqual([{ type: 'disable-component', key: 'wasm-particle-effects' }]);
    const typeOnly = new OptimizerClient(makeHost({ getEnvironment: jest.fn(async () => ({ platform: { type: 'Linux' } })) }));
    await expect(typeOnly.run({ useServer: false })).resolves.toMatchObject({ platform: 'Linux' });
    const unknownPlatform = new OptimizerClient(makeHost({ getEnvironment: jest.fn(async () => ({})) }));
    await expect(unknownPlatform.run({ useServer: false })).resolves.toMatchObject({ platform: 'unknown' });
  });

  test('requests plans, falls back on gateway failures, and applies per-action boundaries', async () => {
    const host = makeHost({ applyAction: jest.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('runtime failed')) });
    const plan = { protocolVersion: 1, actions: [action, { type: 'set-fps-cap', key: 'fps.cap', value: 120 }, { type: 'not-real' }] };
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, plan }) });
    const client = new OptimizerClient(host, { serverUrl: 'https://optimizer.test/plan', fetchFn });
    const report = await client.run();
    expect(report.source).toBe('server');
    expect(report.applied).toHaveLength(1);
    expect(host.emit).toHaveBeenCalledWith('action-rejected', expect.anything());
    expect(host.emit).toHaveBeenCalledWith('action-failed', expect.anything());

    const fallbackHost = makeHost();
    const fallback = new OptimizerClient(fallbackHost, { serverUrl: 'https://optimizer.test/plan', fetchFn: jest.fn().mockResolvedValue({ ok: false, status: 503 }) });
    await expect(fallback.run()).resolves.toEqual(expect.objectContaining({ source: 'local' }));
    expect(fallbackHost.emit).toHaveBeenCalledWith('server-unavailable', expect.objectContaining({ reason: 'Plan request failed: HTTP 503' }));
    await expect(client._requestPlan({}, environment)).resolves.toEqual(plan);
    await expect(client._requestPlan({}, { platform: {} })).resolves.toEqual(plan);
  });

  test('rejects malformed server responses and exposes state controls', async () => {
    const host = makeHost();
    const client = new OptimizerClient(host, { serverUrl: 'https://optimizer.test/plan', fetchFn: jest.fn() });
    expect(() => client._validatePlanStructure(null)).toThrow('actions array');
    expect(() => client._validatePlanStructure({ actions: [], protocolVersion: 2 })).toThrow('mismatch');
    client.options.fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) });
    await expect(client._requestPlan({}, environment)).rejects.toThrow('Plan response missing');
    client.options.fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(client._requestPlan({}, environment)).rejects.toThrow('HTTP 500');
    client.options.fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, plan: { protocolVersion: 1, actions: [], expiresAt: '2000-01-01T00:00:00.000Z' } }) });
    await expect(client._requestPlan({}, environment)).rejects.toThrow('expired');
    client.options.fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, plan: { protocolVersion: 1, actions: [], expiresAt: new Date(Date.now() + 60000).toISOString() } }) });
    await expect(client._requestPlan({}, environment)).resolves.toEqual(expect.objectContaining({ expiresAt: expect.any(String) }));
    client.options.fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    await expect(client._requestPlan({}, environment)).rejects.toThrow('Plan response missing');
    client.options.fetchFn = jest.fn().mockResolvedValue(undefined);
    await expect(client._requestPlan({}, environment)).rejects.toThrow('HTTP unknown');
    const timeoutClient = new OptimizerClient(host, {
      serverUrl: 'https://optimizer.test/plan',
      timeoutMs: 1,
      fetchFn: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    });
    await expect(timeoutClient._requestPlan({}, environment)).rejects.toThrow('aborted');
    client.setConsent(true);
    expect(client._state.consent).toBe(true);
    expect(client._localFallbackPlan({ platform: { mobile: false }, capabilities: { wasm: true }, network: {} }).actions).toEqual([]);
  });
});
