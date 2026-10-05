import {
  CPU_AFFINITY_SMT_TRIGGERS,
  CPU_AFFINITY_SMT_TURBO_ID,
  CPU_AFFINITY_SMT_TURBO_VERSION,
  runCpuAffinitySmtLayoutTurbo
} from '../pc/engines/cpu-affinity/turbos/smt-layout/turbo.js';

function snapshot(physicalCpus, logicalCpus, overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: { physicalCpus, logicalCpus },
    ...overrides
  };
}

describe('CPU-affinity smt-layout turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_AFFINITY_SMT_TURBO_ID).toBe('cpu-affinity.smt-layout');
    expect(CPU_AFFINITY_SMT_TURBO_VERSION).toBe(1);
    expect(CPU_AFFINITY_SMT_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_AFFINITY_SMT_TRIGGERS)).toBe(true);
  });

  test('classifies stable, heavy, inconsistent, and shifted SMT layouts', () => {
    const stable = runCpuAffinitySmtLayoutTurbo([
      snapshot(4, 6), snapshot(4, 6), snapshot(4, 6)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(stable).toMatchObject({ sampleCount: 3, observedCount: 3, unknownCount: 0,
      inconsistentCount: 0, heavySampleCount: 0, peakRatio: 1.5, meanRatio: 1.5,
      ratioRange: 0, state: 'stable-smt', confidence: 1,
      recommendations: ['no-change'], actions: [] });

    const heavy = runCpuAffinitySmtLayoutTurbo([
      snapshot(4, 8), snapshot(4, 8)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(heavy).toMatchObject({ heavySampleCount: 2, peakRatio: 2,
      state: 'heavy-smt', recommendations: ['preserve-os-smt-layout'] });

    const inconsistent = runCpuAffinitySmtLayoutTurbo([
      snapshot(8, 4), snapshot(8, 4)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(inconsistent).toMatchObject({ inconsistentCount: 2,
      state: 'inconsistent-layout', recommendations: ['reject-unverified-smt-layout'] });

    const shifted = runCpuAffinitySmtLayoutTurbo([
      snapshot(4, 6), snapshot(4, 8), snapshot(4, 8)
    ], { trigger: 'health.interval', ratioThreshold: 3, now: () => 0 });
    expect(shifted).toMatchObject({ heavySampleCount: 0, peakRatio: 2,
      ratioRange: 0.5, state: 'ratio-shift', recommendations: ['observe-next-smt-sample'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows and preserves sparse, empty, and unknown evidence', () => {
    const empty = runCpuAffinitySmtLayoutTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-smt-samples'] });

    const bounded = runCpuAffinitySmtLayoutTurbo([
      snapshot(2, 4), snapshot(4, 8), snapshot(8, 16), snapshot(4, 8)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, observedCount: 2, peakRatio: 2 });

    const insufficient = runCpuAffinitySmtLayoutTurbo([snapshot(4, 8)], {
      trigger: 'health.interval', minimumSamples: 2, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const unknown = runCpuAffinitySmtLayoutTurbo([
      snapshot(null, null), snapshot('bad', 'bad')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2,
      peakRatio: null, meanRatio: null, ratioRange: 0,
      state: 'no-observation', confidence: 0,
      recommendations: ['request-smt-topology-observation'] });

    const normalized = runCpuAffinitySmtLayoutTurbo([
      snapshot(2, 4), snapshot(0, 0), snapshot(4, 9)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(normalized).toMatchObject({ observedCount: 2, peakRatio: 2.25 });
  });

  test('rejects malformed inputs, limits, thresholds, snapshots, and clocks', () => {
    expect(() => runCpuAffinitySmtLayoutTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuAffinitySmtLayoutTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-affinity smt-layout trigger: bad');
    expect(() => runCpuAffinitySmtLayoutTurbo())
      .toThrow('Unsupported CPU-affinity smt-layout trigger: unknown');
    expect(() => runCpuAffinitySmtLayoutTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuAffinitySmtLayoutTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuAffinitySmtLayoutTurbo([], {
      trigger: 'health.interval', ratioThreshold: 0.5
    })).toThrow('ratioThreshold must be between 1 and 8');
    expect(() => runCpuAffinitySmtLayoutTurbo([], {
      trigger: 'health.interval', rangeThreshold: 9
    })).toThrow('rangeThreshold must be between 0 and 8');
    expect(() => runCpuAffinitySmtLayoutTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuAffinitySmtLayoutTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runCpuAffinitySmtLayoutTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuAffinitySmtLayoutTurbo([
      snapshot(4, 8, { cpu: null }), snapshot(4, 8)
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
