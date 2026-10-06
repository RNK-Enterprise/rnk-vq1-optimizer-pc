import {
  STORAGE_HEALTH_CAPACITY_DRIFT_TURBO_ID,
  runStorageHealthCapacityDriftTurbo
} from '../pc/engines/storage-health/turbos/capacity-drift/turbo.js';

const facts = (storage, environment = 'interactive') => ({ engine: 'system-facts', environment, storage });

describe('storage-health capacity-drift turbo', () => {
  test('detects sustained capacity pressure without cleanup', () => {
    const result = runStorageHealthCapacityDriftTurbo([
      facts([{ usedPercent: 94 }]), facts([{ usedPercent: 96 }])
    ], { trigger: 'workload.changed', minimumSamples: 2, capacityThreshold: 90,
      persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(STORAGE_HEALTH_CAPACITY_DRIFT_TURBO_ID);
    expect(result.state).toBe('capacity-pressure-sustained');
    expect(result.pressureSampleCount).toBe(2);
    expect(result.maximumUsedPercent).toBe(96);
    expect(result.recommendations).toEqual(['review-free-space', 'hold-automatic-cleanup']);
    expect(result.actions).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, stable, empty, and incomplete samples', () => {
    const observed = runStorageHealthCapacityDriftTurbo([
      facts([{ usedPercent: 95 }]), facts([{ usedPercent: 50 }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const stable = runStorageHealthCapacityDriftTurbo([
      facts([{ usedPercent: 50 }]), facts([{ usedPercent: 60 }])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runStorageHealthCapacityDriftTurbo([facts([]), facts([])], {
      trigger: 'install.preflight', now: () => 0
    });
    const incomplete = runStorageHealthCapacityDriftTurbo([
      facts([{ mount: '/data' }], 'unknown'), facts([{ mount: '/data' }])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(observed.state).toBe('capacity-pressure-observed');
    expect(stable.state).toBe('stable-capacity');
    expect(empty.state).toBe('no-storage');
    expect(incomplete.state).toBe('incomplete-capacity-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runStorageHealthCapacityDriftTurbo([
      facts([{ usedPercent: 95 }]), facts([{ usedPercent: 40 }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runStorageHealthCapacityDriftTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1);
    expect(bounded.maximumUsedPercent).toBe(40);
    expect(bounded.state).toBe('stable-capacity');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runStorageHealthCapacityDriftTurbo()).toThrow();
    expect(() => runStorageHealthCapacityDriftTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runStorageHealthCapacityDriftTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthCapacityDriftTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthCapacityDriftTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthCapacityDriftTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthCapacityDriftTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runStorageHealthCapacityDriftTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow();
    expect(() => runStorageHealthCapacityDriftTurbo([], { trigger: 'health.interval', capacityThreshold: 101 })).toThrow();
    expect(() => runStorageHealthCapacityDriftTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow();
    expect(() => runStorageHealthCapacityDriftTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
