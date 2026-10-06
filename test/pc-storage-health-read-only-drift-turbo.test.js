import {
  STORAGE_HEALTH_READ_ONLY_DRIFT_TURBO_ID,
  runStorageHealthReadOnlyDriftTurbo
} from '../pc/engines/storage-health/turbos/read-only-drift/turbo.js';

const facts = (storage, environment = 'interactive') => ({ engine: 'system-facts', environment, storage });

describe('storage-health read-only-drift turbo', () => {
  test('detects sustained read-only evidence without remounting', () => {
    const result = runStorageHealthReadOnlyDriftTurbo([
      facts([{ readOnly: true }, { readOnly: false }]),
      facts([{ readOnly: true }, { readOnly: true }])
    ], { trigger: 'workload.changed', minimumSamples: 2, readOnlyThreshold: 0.5,
      persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(STORAGE_HEALTH_READ_ONLY_DRIFT_TURBO_ID);
    expect(result.state).toBe('read-only-increase-sustained');
    expect(result.elevatedSampleCount).toBe(2);
    expect(result.readOnlyRatio).toBe(1);
    expect(result.recommendations).toEqual(['review-mount-state', 'hold-remount-policy']);
    expect(result.actions).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, stable, empty, and incomplete samples', () => {
    const observed = runStorageHealthReadOnlyDriftTurbo([
      facts([{ readOnly: true }]), facts([{ readOnly: false }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const stable = runStorageHealthReadOnlyDriftTurbo([
      facts([{ readOnly: false }]), facts([{ readOnly: false }])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runStorageHealthReadOnlyDriftTurbo([facts([]), facts([])], {
      trigger: 'install.preflight', now: () => 0
    });
    const incomplete = runStorageHealthReadOnlyDriftTurbo([
      facts([{ mount: '/data' }], 'unknown'), facts([{ mount: '/data' }])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(observed.state).toBe('read-only-observed');
    expect(stable.state).toBe('stable-read-only');
    expect(empty.state).toBe('no-storage');
    expect(incomplete.state).toBe('incomplete-read-only-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runStorageHealthReadOnlyDriftTurbo([
      facts([{ readOnly: true }]), facts([{ readOnly: false }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runStorageHealthReadOnlyDriftTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1);
    expect(bounded.readOnlyCount).toBe(0);
    expect(bounded.state).toBe('stable-read-only');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runStorageHealthReadOnlyDriftTurbo()).toThrow();
    expect(() => runStorageHealthReadOnlyDriftTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runStorageHealthReadOnlyDriftTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthReadOnlyDriftTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthReadOnlyDriftTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthReadOnlyDriftTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthReadOnlyDriftTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runStorageHealthReadOnlyDriftTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow();
    expect(() => runStorageHealthReadOnlyDriftTurbo([], { trigger: 'health.interval', readOnlyThreshold: 1.1 })).toThrow();
    expect(() => runStorageHealthReadOnlyDriftTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow();
    expect(() => runStorageHealthReadOnlyDriftTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
