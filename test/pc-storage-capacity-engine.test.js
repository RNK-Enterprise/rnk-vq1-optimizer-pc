import {
  STORAGE_CAPACITY_ENGINE_ID,
  STORAGE_CAPACITY_ENGINE_VERSION,
  STORAGE_CAPACITY_TRIGGERS,
  runStorageCapacityEngine
} from '../pc/engines/storage-capacity/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    storage: [
      { mount: '/', totalBytes: 1000, freeBytes: 400 },
      { mount: '/data', totalBytes: 2000, freeBytes: 500 }
    ],
    ...overrides
  };
}

describe('Storage-capacity engine', () => {
  test('publishes identity and triggers', () => {
    expect(STORAGE_CAPACITY_ENGINE_ID).toBe('storage-capacity');
    expect(STORAGE_CAPACITY_ENGINE_VERSION).toBe(1);
    expect(STORAGE_CAPACITY_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(STORAGE_CAPACITY_TRIGGERS)).toBe(true);
  });

  test('reports storage headroom without changing files', () => {
    const result = runStorageCapacityEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: STORAGE_CAPACITY_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      storageCount: 2,
      mounts: ['/', '/data'],
      totalBytes: 3000,
      freeBytes: 900,
      minimumFreePercent: 25,
      level: 'normal',
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('classifies elevated and high free-space pressure', () => {
    expect(runStorageCapacityEngine(facts({ storage: [
      { mount: '/', totalBytes: 1000, freeBytes: 200 }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      minimumFreePercent: 20,
      level: 'elevated',
      state: 'watch',
      recommendations: ['observe-storage-headroom']
    });
    expect(runStorageCapacityEngine(facts({ storage: [
      { mount: '/', totalBytes: 1000, freeBytes: 100 }
    ] }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      minimumFreePercent: 10,
      level: 'high',
      state: 'capacity-review',
      recommendations: ['review-free-space-before-workload']
    });
  });

  test('reports unknown and bounds capacity observations', () => {
    expect(runStorageCapacityEngine(facts({ storage: [{}] }), {
      trigger: 'system.facts.request',
      now: () => 0
    })).toMatchObject({
      storageCount: 1,
      mounts: [],
      totalBytes: null,
      freeBytes: null,
      minimumFreePercent: null,
      level: 'unknown',
      state: 'observation-required',
      confidence: 0.4,
      recommendations: ['request-storage-capacity-observation']
    });
    expect(runStorageCapacityEngine(facts({ storage: [null, {
      mount: '', totalBytes: 1000, freeBytes: 1200
    }] }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      storageCount: 1,
      totalBytes: 1000,
      freeBytes: 1000,
      minimumFreePercent: 100
    });
    expect(runStorageCapacityEngine(facts({
      environment: 'headless',
      storage: []
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      storageCount: 0,
      level: 'unknown',
      state: 'no-storage',
      confidence: 0.2,
      recommendations: ['no-storage-capacity-review']
    });
  });

  test('requires a known environment, facts, storage list, triggers, and clock', () => {
    expect(runStorageCapacityEngine(facts({
      environment: 'other',
      storage: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(() => runStorageCapacityEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runStorageCapacityEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runStorageCapacityEngine(facts({ storage: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a storage list');
    expect(() => runStorageCapacityEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported storage-capacity trigger: bad');
    expect(() => runStorageCapacityEngine(facts(), {}))
      .toThrow('Unsupported storage-capacity trigger: unknown');
    expect(() => runStorageCapacityEngine())
      .toThrow('Unsupported storage-capacity trigger: unknown');
    expect(() => runStorageCapacityEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Storage-capacity clock must return a number');
  });
});
