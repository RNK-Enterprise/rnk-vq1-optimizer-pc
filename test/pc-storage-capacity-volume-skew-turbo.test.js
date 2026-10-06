import {
  STORAGE_CAPACITY_VOLUME_SKEW_TURBO_ID,
  runStorageCapacityVolumeSkewTurbo
} from '../pc/engines/storage-capacity/turbos/volume-skew/turbo.js';

const facts = (storage, environment = 'interactive') => ({ engine: 'system-facts', environment, storage });
const volume = (freeBytes, totalBytes = 1000) => ({ totalBytes, freeBytes });

describe('storage-capacity volume-skew turbo', () => {
  test('detects sustained per-volume headroom skew', () => {
    const result = runStorageCapacityVolumeSkewTurbo([
      facts([volume(100), volume(800)]), facts([volume(150), volume(850)])
    ], { trigger: 'workload.changed', minimumSamples: 2, skewThreshold: 30, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(STORAGE_CAPACITY_VOLUME_SKEW_TURBO_ID);
    expect(result.state).toBe('volume-skew-sustained');
    expect(result.skewSampleCount).toBe(2);
    expect(result.skewPercent).toBe(70);
    expect(result.recommendations).toEqual(['review-volume-headroom', 'hold-automatic-rebalancing']);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, balanced, empty, and incomplete samples', () => {
    const observed = runStorageCapacityVolumeSkewTurbo([
      facts([volume(100), volume(800)]), facts([volume(500), volume(600)])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const balanced = runStorageCapacityVolumeSkewTurbo([
      facts([volume(500), volume(600)]), facts([volume(550), volume(650)])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const single = runStorageCapacityVolumeSkewTurbo([facts([volume(500)]), facts([volume(500)])], {
      trigger: 'install.preflight', now: () => 0
    });
    const empty = runStorageCapacityVolumeSkewTurbo([facts([]), facts([])], { trigger: 'install.preflight', now: () => 0 });
    const incomplete = runStorageCapacityVolumeSkewTurbo([
      facts([{ totalBytes: 1000 }], 'unknown'), facts([{ totalBytes: 1000 }])
    ], { trigger: 'health.interval', now: () => 0 });
    const incompleteRows = runStorageCapacityVolumeSkewTurbo([
      facts([{ totalBytes: null, freeBytes: null }, { totalBytes: 0, freeBytes: 0 }, { totalBytes: 1000 }])
    ], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    expect(observed.state).toBe('volume-skew-observed');
    expect(balanced.state).toBe('balanced-volumes');
    expect(single.state).toBe('balanced-volumes');
    expect(empty.state).toBe('no-storage');
    expect(incomplete.state).toBe('incomplete-skew-evidence');
    expect(incompleteRows.state).toBe('incomplete-skew-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runStorageCapacityVolumeSkewTurbo([
      facts([volume(100), volume(800)]), facts([volume(500), volume(600)])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runStorageCapacityVolumeSkewTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1);
    expect(bounded.skewPercent).toBe(10);
    expect(bounded.state).toBe('balanced-volumes');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runStorageCapacityVolumeSkewTurbo()).toThrow();
    expect(() => runStorageCapacityVolumeSkewTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runStorageCapacityVolumeSkewTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityVolumeSkewTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityVolumeSkewTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityVolumeSkewTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityVolumeSkewTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runStorageCapacityVolumeSkewTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow();
    expect(() => runStorageCapacityVolumeSkewTurbo([], { trigger: 'health.interval', skewThreshold: 101 })).toThrow();
    expect(() => runStorageCapacityVolumeSkewTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow();
    expect(() => runStorageCapacityVolumeSkewTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
