import {
  CPU_AFFINITY_DRIFT_TRIGGERS,
  CPU_AFFINITY_DRIFT_TURBO_ID,
  CPU_AFFINITY_DRIFT_TURBO_VERSION,
  runCpuAffinityMaskDriftTurbo
} from '../pc/engines/cpu-affinity/turbos/mask-drift/turbo.js';

function snapshot(affinityCpus, isolatedCpus, overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: { affinityCpus, isolatedCpus },
    ...overrides
  };
}

describe('CPU-affinity mask-drift turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_AFFINITY_DRIFT_TURBO_ID).toBe('cpu-affinity.mask-drift');
    expect(CPU_AFFINITY_DRIFT_TURBO_VERSION).toBe(1);
    expect(CPU_AFFINITY_DRIFT_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_AFFINITY_DRIFT_TRIGGERS)).toBe(true);
  });

  test('classifies stable, high, frequent, and watch drift', () => {
    const stable = runCpuAffinityMaskDriftTurbo([
      snapshot([0, 1], [2, 3]), snapshot([0, 1], [2, 3]), snapshot([0, 1], [2, 3])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(stable).toMatchObject({ sampleCount: 3, observedCount: 3, comparisonCount: 2,
      changeCount: 0, peakDrift: 0, meanDrift: 0, state: 'stable-layout', confidence: 1,
      recommendations: ['no-change'], actions: [] });

    const high = runCpuAffinityMaskDriftTurbo([
      snapshot([0, 1, 2, 3], [4]), snapshot([4, 5, 6, 7], [4])
    ], { trigger: 'workload.changed', changeThreshold: 3, now: () => 0 });
    expect(high).toMatchObject({ changeCount: 1, peakDrift: 1, state: 'high-drift',
      recommendations: ['review-affinity-list-change'] });

    const frequent = runCpuAffinityMaskDriftTurbo([
      snapshot([0], [1]), snapshot([1], [2]), snapshot([2], [3]), snapshot([3], [4])
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(frequent).toMatchObject({ changeCount: 3, peakDrift: 1,
      state: 'frequent-drift', recommendations: ['observe-affinity-change-duration'] });

    const watch = runCpuAffinityMaskDriftTurbo([
      snapshot([0, 1], [2, 3]), snapshot([0, 2], [2, 3]), snapshot([0, 2], [2, 4])
    ], { trigger: 'health.interval', changeThreshold: 3, driftThreshold: 1, now: () => 0 });
    expect(watch).toMatchObject({ changeCount: 2, peakDrift: 0.6667,
      state: 'drift-watch', recommendations: ['observe-next-affinity-sample'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows and preserves sparse, empty, and unknown evidence', () => {
    const empty = runCpuAffinityMaskDriftTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-affinity-samples'] });

    const bounded = runCpuAffinityMaskDriftTurbo([
      snapshot([0], [1]), snapshot([0, 1], [2]), snapshot([0, 1, 2], [3]), snapshot([0, 1, 2, 3], [4])
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, comparisonCount: 1, changeCount: 1 });

    const insufficient = runCpuAffinityMaskDriftTurbo([snapshot([0], [1])], {
      trigger: 'health.interval', minimumSamples: 2, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const unknown = runCpuAffinityMaskDriftTurbo([
      snapshot(null, null), snapshot('bad', 'bad')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2,
      comparisonCount: 0, changeCount: 0, peakDrift: null, meanDrift: null,
      state: 'no-observation', confidence: 0,
      recommendations: ['request-affinity-drift-observation'] });

    const normalized = runCpuAffinityMaskDriftTurbo([
      snapshot([3, 1, 1, -1], [2, 0, 2]), snapshot([], [])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(normalized).toMatchObject({ observedCount: 2, comparisonCount: 1, changeCount: 1 });

    const emptyPair = runCpuAffinityMaskDriftTurbo([
      snapshot([], []), snapshot([], [])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(emptyPair).toMatchObject({ comparisonCount: 1, changeCount: 0, peakDrift: 0 });

    const partial = runCpuAffinityMaskDriftTurbo([
      snapshot(null, [1]), snapshot([0], [1]), snapshot([0], null), snapshot([0], [1])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(partial.comparisonCount).toBe(3);
  });

  test('rejects malformed inputs, limits, thresholds, snapshots, and clocks', () => {
    expect(() => runCpuAffinityMaskDriftTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuAffinityMaskDriftTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-affinity mask-drift trigger: bad');
    expect(() => runCpuAffinityMaskDriftTurbo())
      .toThrow('Unsupported CPU-affinity mask-drift trigger: unknown');
    expect(() => runCpuAffinityMaskDriftTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuAffinityMaskDriftTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuAffinityMaskDriftTurbo([], {
      trigger: 'health.interval', driftThreshold: 1.1
    })).toThrow('driftThreshold must be between 0 and 1');
    expect(() => runCpuAffinityMaskDriftTurbo([], {
      trigger: 'health.interval', changeThreshold: 65
    })).toThrow('changeThreshold must be an integer from 1 to 64');
    expect(() => runCpuAffinityMaskDriftTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuAffinityMaskDriftTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runCpuAffinityMaskDriftTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuAffinityMaskDriftTurbo([
      snapshot([0], [1], { cpu: null }), snapshot([0], [1])
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
