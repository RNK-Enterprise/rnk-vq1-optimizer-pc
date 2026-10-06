import {
  STORAGE_HEALTH_HEALTH_DEGRADATION_TURBO_ID,
  runStorageHealthHealthDegradationTurbo
} from '../pc/engines/storage-health/turbos/health-degradation/turbo.js';

const facts = (storage, environment = 'interactive') => ({ engine: 'system-facts', environment, storage });

describe('storage-health health-degradation turbo', () => {
  test('detects sustained failed health evidence without repair', () => {
    const result = runStorageHealthHealthDegradationTurbo([
      facts([{ health: 'failed' }]), facts([{ health: 'failed' }])
    ], { trigger: 'workload.changed', minimumSamples: 2, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(STORAGE_HEALTH_HEALTH_DEGRADATION_TURBO_ID);
    expect(result.state).toBe('health-failure-sustained');
    expect(result.failureSampleCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.recommendations).toEqual(['protect-data', 'request-user-approved-storage-review']);
    expect(result.actions).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes degradation, healthy, empty, and incomplete samples', () => {
    const degraded = runStorageHealthHealthDegradationTurbo([
      facts([{ health: 'degraded' }]), facts([{ health: 'healthy' }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const healthy = runStorageHealthHealthDegradationTurbo([
      facts([{ health: 'healthy' }]), facts([{ health: 'healthy' }])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runStorageHealthHealthDegradationTurbo([facts([]), facts([])], {
      trigger: 'install.preflight', now: () => 0
    });
    const incomplete = runStorageHealthHealthDegradationTurbo([
      facts([{ mount: '/data' }], 'unknown'), facts([{ health: 'mystery' }])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(degraded.state).toBe('health-degradation-observed');
    expect(healthy.state).toBe('healthy-storage');
    expect(empty.state).toBe('no-storage');
    expect(incomplete.state).toBe('incomplete-health-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runStorageHealthHealthDegradationTurbo([
      facts([{ health: 'failed' }]), facts([{ health: 'healthy' }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runStorageHealthHealthDegradationTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1);
    expect(bounded.failedCount).toBe(0);
    expect(bounded.state).toBe('healthy-storage');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runStorageHealthHealthDegradationTurbo()).toThrow();
    expect(() => runStorageHealthHealthDegradationTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runStorageHealthHealthDegradationTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthHealthDegradationTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthHealthDegradationTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthHealthDegradationTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthHealthDegradationTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runStorageHealthHealthDegradationTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow();
    expect(() => runStorageHealthHealthDegradationTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow();
    expect(() => runStorageHealthHealthDegradationTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
