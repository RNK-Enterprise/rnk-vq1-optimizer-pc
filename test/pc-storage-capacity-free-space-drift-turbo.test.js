import {
  STORAGE_CAPACITY_FREE_SPACE_DRIFT_TURBO_ID,
  runStorageCapacityFreeSpaceDriftTurbo
} from '../pc/engines/storage-capacity/turbos/free-space-drift/turbo.js';

const facts = (storage, environment = 'interactive') => ({ engine: 'system-facts', environment, storage });
const volume = (freeBytes) => ({ totalBytes: 1000, freeBytes });

describe('storage-capacity free-space-drift turbo', () => {
  test('detects sustained headroom pressure without cleanup', () => {
    const result = runStorageCapacityFreeSpaceDriftTurbo([
      facts([volume(100)]), facts([volume(150)])
    ], { trigger: 'workload.changed', minimumSamples: 2, headroomThreshold: 20, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(STORAGE_CAPACITY_FREE_SPACE_DRIFT_TURBO_ID);
    expect(result.state).toBe('headroom-pressure-sustained');
    expect(result.pressureSampleCount).toBe(2);
    expect(result.minimumFreePercent).toBe(15);
    expect(result.recommendations).toEqual(['review-free-space', 'hold-automatic-cleanup']);
    expect(result.actions).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, stable, empty, and incomplete samples', () => {
    const observed = runStorageCapacityFreeSpaceDriftTurbo([
      facts([volume(100)]), facts([volume(500)])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const stable = runStorageCapacityFreeSpaceDriftTurbo([
      facts([volume(500)]), facts([volume(600)])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runStorageCapacityFreeSpaceDriftTurbo([facts([]), facts([])], { trigger: 'install.preflight', now: () => 0 });
    const incomplete = runStorageCapacityFreeSpaceDriftTurbo([
      facts([{ totalBytes: 1000 }], 'unknown'), facts([{ totalBytes: 1000 }])
    ], { trigger: 'health.interval', now: () => 0 });
    const incompleteRows = runStorageCapacityFreeSpaceDriftTurbo([
      facts([{ totalBytes: null, freeBytes: null }, { totalBytes: 0, freeBytes: 0 }, { totalBytes: 1000 }])
    ], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 });
    expect(observed.state).toBe('headroom-pressure-observed');
    expect(stable.state).toBe('stable-headroom');
    expect(empty.state).toBe('no-storage');
    expect(incomplete.state).toBe('incomplete-headroom-evidence');
    expect(incompleteRows.state).toBe('incomplete-headroom-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runStorageCapacityFreeSpaceDriftTurbo([
      facts([volume(100)]), facts([volume(700)])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runStorageCapacityFreeSpaceDriftTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1);
    expect(bounded.minimumFreePercent).toBe(70);
    expect(bounded.state).toBe('stable-headroom');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runStorageCapacityFreeSpaceDriftTurbo()).toThrow();
    expect(() => runStorageCapacityFreeSpaceDriftTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runStorageCapacityFreeSpaceDriftTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityFreeSpaceDriftTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityFreeSpaceDriftTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityFreeSpaceDriftTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityFreeSpaceDriftTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runStorageCapacityFreeSpaceDriftTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow();
    expect(() => runStorageCapacityFreeSpaceDriftTurbo([], { trigger: 'health.interval', headroomThreshold: 101 })).toThrow();
    expect(() => runStorageCapacityFreeSpaceDriftTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow();
    expect(() => runStorageCapacityFreeSpaceDriftTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
