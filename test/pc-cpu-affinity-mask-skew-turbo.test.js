import {
  CPU_AFFINITY_MASK_TRIGGERS,
  CPU_AFFINITY_MASK_TURBO_ID,
  CPU_AFFINITY_MASK_TURBO_VERSION,
  runCpuAffinityMaskSkewTurbo
} from '../pc/engines/cpu-affinity/turbos/mask-skew/turbo.js';

function snapshot(logicalCpus, affinityCpus, isolatedCpus, overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: { logicalCpus, affinityCpus, isolatedCpus },
    ...overrides
  };
}

describe('CPU-affinity mask-skew turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_AFFINITY_MASK_TURBO_ID).toBe('cpu-affinity.mask-skew');
    expect(CPU_AFFINITY_MASK_TURBO_VERSION).toBe(1);
    expect(CPU_AFFINITY_MASK_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_AFFINITY_MASK_TRIGGERS)).toBe(true);
  });

  test('classifies stable, overlap, over-isolated, and under-covered layouts', () => {
    const stable = runCpuAffinityMaskSkewTurbo([
      snapshot(8, [0, 1, 2, 3], [4]), snapshot(8, [0, 1, 2, 3], [4])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(stable).toMatchObject({ sampleCount: 2, observedCount: 2, unknownCount: 0,
      overlapSampleCount: 0, overIsolatedSampleCount: 0, underCoveredSampleCount: 0,
      peakAffinityCoverage: 0.5, peakIsolationCoverage: 0.125, peakOverlapCount: 0,
      state: 'stable-layout', confidence: 1,
      recommendations: ['no-change'], actions: [] });

    const overlap = runCpuAffinityMaskSkewTurbo([
      snapshot(8, [0, 1, 2], [2, 3]), snapshot(8, [0, 1, 2], [2, 3])
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(overlap).toMatchObject({ overlapSampleCount: 2, peakOverlapCount: 1,
      state: 'overlap-risk', recommendations: ['review-affinity-isolation-overlap'] });

    const underCovered = runCpuAffinityMaskSkewTurbo([
      snapshot(8, [0], [7]), snapshot(8, [0], [7])
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(underCovered).toMatchObject({ overlapSampleCount: 0, underCoveredSampleCount: 2,
      state: 'under-covered', recommendations: ['review-affinity-cpu-coverage'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows and preserves sparse, empty, and unknown evidence', () => {
    const empty = runCpuAffinityMaskSkewTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-affinity-samples'] });

    const bounded = runCpuAffinityMaskSkewTurbo([
      snapshot(8, [0], [7]), snapshot(8, [0, 1], [6, 7]),
      snapshot(8, [0, 1, 2], [5, 6, 7]), snapshot(8, [0, 1, 2, 3], [4, 5, 6, 7])
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, peakAffinityCoverage: 0.5 });

    const insufficient = runCpuAffinityMaskSkewTurbo([snapshot(8, [0], [7])], {
      trigger: 'health.interval', minimumSamples: 2, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const unknown = runCpuAffinityMaskSkewTurbo([
      snapshot(null, null, null), snapshot('bad', 'bad', 'bad')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2,
      peakAffinityCoverage: null, peakIsolationCoverage: null, peakOverlapCount: null,
      state: 'no-observation', confidence: 0,
      recommendations: ['request-affinity-topology-observation'] });

    const normalized = runCpuAffinityMaskSkewTurbo([
      snapshot(4, [3, 1, 1, -1], [2, 0, 2]), snapshot(4, [], []), snapshot(8, null, null)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(normalized).toMatchObject({ observedCount: 2, peakAffinityCoverage: 0.5,
      peakIsolationCoverage: 0.5 });
  });

  test('rejects malformed inputs, limits, thresholds, snapshots, and clocks', () => {
    expect(() => runCpuAffinityMaskSkewTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuAffinityMaskSkewTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-affinity mask-skew trigger: bad');
    expect(() => runCpuAffinityMaskSkewTurbo())
      .toThrow('Unsupported CPU-affinity mask-skew trigger: unknown');
    expect(() => runCpuAffinityMaskSkewTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuAffinityMaskSkewTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuAffinityMaskSkewTurbo([], {
      trigger: 'health.interval', coverageThreshold: 1.1
    })).toThrow('coverageThreshold must be between 0 and 1');
    expect(() => runCpuAffinityMaskSkewTurbo([], {
      trigger: 'health.interval', overlapThreshold: 65
    })).toThrow('overlapThreshold must be an integer from 1 to 64');
    expect(() => runCpuAffinityMaskSkewTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuAffinityMaskSkewTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runCpuAffinityMaskSkewTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuAffinityMaskSkewTurbo([
      snapshot(4, [0], [1], { cpu: null }), snapshot(4, [0], [1])
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
