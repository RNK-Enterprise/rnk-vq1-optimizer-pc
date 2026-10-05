import {
  STORAGE_HEALTH_ENGINE_ID,
  STORAGE_HEALTH_ENGINE_VERSION,
  STORAGE_HEALTH_TRIGGERS,
  runStorageHealthEngine
} from '../pc/engines/storage-health/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    storage: [
      { mount: '/', device: '/dev/nvme0n1', usedPercent: 40, health: 'healthy', readOnly: false },
      { mount: '/data', device: '/dev/sdb1', usedPercent: 50, health: 'healthy', readOnly: true }
    ],
    ...overrides
  };
}

describe('Storage-health engine', () => {
  test('publishes identity and triggers', () => {
    expect(STORAGE_HEALTH_ENGINE_ID).toBe('storage-health');
    expect(STORAGE_HEALTH_ENGINE_VERSION).toBe(1);
    expect(STORAGE_HEALTH_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(STORAGE_HEALTH_TRIGGERS)).toBe(true);
  });

  test('reports normal storage health without changes', () => {
    const result = runStorageHealthEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: STORAGE_HEALTH_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      storageCount: 2,
      mounts: ['/', '/data'],
      devices: ['/dev/nvme0n1', '/dev/sdb1'],
      maximumUsedPercent: 50,
      degradedCount: 0,
      failedCount: 0,
      unknownHealthCount: 0,
      readOnlyCount: 1,
      level: 'normal',
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('classifies elevated and high occupancy or health', () => {
    expect(runStorageHealthEngine(facts({ storage: [
      { mount: '/', usedPercent: 80, health: 'degraded', readOnly: false }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      maximumUsedPercent: 80,
      degradedCount: 1,
      level: 'elevated',
      state: 'watch',
      recommendations: ['observe-storage-headroom']
    });
    expect(runStorageHealthEngine(facts({ storage: [
      { mount: '/', usedPercent: 90, health: 'healthy', readOnly: false }
    ] }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      level: 'high',
      state: 'capacity-review',
      recommendations: ['review-free-space-before-workload']
    });
    expect(runStorageHealthEngine(facts({ storage: [
      { mount: '/', usedPercent: 40, health: 'failed', readOnly: false }
    ] }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      failedCount: 1,
      level: 'high',
      state: 'protect-data',
      recommendations: ['protect-data', 'request-user-approved-storage-review']
    });
  });

  test('reports unknown, empty, malformed, and bounded storage facts', () => {
    expect(runStorageHealthEngine(facts({ storage: [{}] }), {
      trigger: 'system.facts.request',
      now: () => 0
    })).toMatchObject({
      storageCount: 1,
      mounts: [],
      devices: [],
      maximumUsedPercent: null,
      unknownHealthCount: 1,
      level: 'unknown',
      state: 'observation-required',
      confidence: 0.4,
      recommendations: ['request-storage-health-observation']
    });
    expect(runStorageHealthEngine(facts({ storage: [null, {
      mount: '', device: '', usedPercent: 120, health: 'vendor-health', readOnly: 1
    }] }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      storageCount: 1,
      maximumUsedPercent: 100,
      unknownHealthCount: 1,
      readOnlyCount: 0,
      level: 'high'
    });
    expect(runStorageHealthEngine(facts({
      environment: 'headless',
      storage: []
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      storageCount: 0,
      level: 'unknown',
      state: 'no-storage',
      confidence: 0.2,
      recommendations: ['no-storage-health-review']
    });
  });

  test('requires a known environment, facts, storage list, triggers, and clock', () => {
    expect(runStorageHealthEngine(facts({
      environment: 'other',
      storage: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(() => runStorageHealthEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runStorageHealthEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runStorageHealthEngine(facts({ storage: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a storage list');
    expect(() => runStorageHealthEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported storage-health trigger: bad');
    expect(() => runStorageHealthEngine(facts(), {}))
      .toThrow('Unsupported storage-health trigger: unknown');
    expect(() => runStorageHealthEngine())
      .toThrow('Unsupported storage-health trigger: unknown');
    expect(() => runStorageHealthEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Storage-health clock must return a number');
  });
});
