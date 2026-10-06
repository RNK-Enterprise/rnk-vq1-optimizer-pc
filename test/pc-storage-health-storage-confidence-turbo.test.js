import {
  STORAGE_HEALTH_STORAGE_CONFIDENCE_TURBO_ID,
  runStorageHealthStorageConfidenceTurbo
} from '../pc/engines/storage-health/turbos/storage-confidence/turbo.js';

const complete = (mount = '/data') => ({ mount, usedPercent: 50, health: 'healthy', readOnly: false });
const facts = (storage, environment = 'interactive') => ({ engine: 'system-facts', environment, storage });

describe('storage-health storage-confidence turbo', () => {
  test('detects sustained low-confidence storage evidence without probing', () => {
    const result = runStorageHealthStorageConfidenceTurbo([
      facts([complete(), { usedPercent: 50, health: 'healthy', readOnly: false }]),
      facts([complete(), { mount: '/backup', health: 'healthy', readOnly: false }])
    ], { trigger: 'workload.changed', minimumSamples: 2, completenessThreshold: 0.75,
      persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(STORAGE_HEALTH_STORAGE_CONFIDENCE_TURBO_ID);
    expect(result.state).toBe('low-confidence-sustained');
    expect(result.lowConfidenceSampleCount).toBe(2);
    expect(result.completenessRatio).toBe(0.5);
    expect(result.recommendations).toEqual(['request-complete-storage-facts']);
    expect(result.actions).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, complete, empty, and incomplete samples', () => {
    const observed = runStorageHealthStorageConfidenceTurbo([
      facts([complete(), { mount: '/backup', usedPercent: 50, health: 'healthy', readOnly: false }]),
      facts([complete(), { mount: '/backup' }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const completeResult = runStorageHealthStorageConfidenceTurbo([
      facts([complete()]), facts([complete()])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runStorageHealthStorageConfidenceTurbo([facts([]), facts([])], {
      trigger: 'install.preflight', now: () => 0
    });
    const incomplete = runStorageHealthStorageConfidenceTurbo([
      facts([complete()], 'unknown'), facts([complete()], 'unknown')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(observed.state).toBe('low-confidence-observed');
    expect(completeResult.state).toBe('complete-storage-observation');
    expect(empty.state).toBe('no-storage');
    expect(incomplete.state).toBe('incomplete-confidence-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runStorageHealthStorageConfidenceTurbo([
      facts([complete()]), facts([{ mount: '/backup' }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runStorageHealthStorageConfidenceTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1);
    expect(bounded.completenessRatio).toBe(0);
    expect(bounded.state).toBe('low-confidence-observed');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runStorageHealthStorageConfidenceTurbo()).toThrow();
    expect(() => runStorageHealthStorageConfidenceTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runStorageHealthStorageConfidenceTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthStorageConfidenceTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthStorageConfidenceTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthStorageConfidenceTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageHealthStorageConfidenceTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runStorageHealthStorageConfidenceTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow();
    expect(() => runStorageHealthStorageConfidenceTurbo([], { trigger: 'health.interval', completenessThreshold: 1.1 })).toThrow();
    expect(() => runStorageHealthStorageConfidenceTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow();
    expect(() => runStorageHealthStorageConfidenceTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
