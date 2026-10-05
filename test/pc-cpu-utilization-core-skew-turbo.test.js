import {
  CPU_UTILIZATION_CORE_SKEW_TRIGGERS,
  CPU_UTILIZATION_CORE_SKEW_TURBO_ID,
  CPU_UTILIZATION_CORE_SKEW_TURBO_VERSION,
  runCpuUtilizationCoreSkewTurbo
} from '../pc/engines/cpu-utilization/turbos/core-skew/turbo.js';

function snapshot(cores, overrides = {}) {
  return { engine: 'system-facts', cpu: { cores }, ...overrides };
}

describe('CPU-utilization core-skew turbo', () => {
  test('publishes immutable identity and classifies balanced and skewed cores', () => {
    expect(CPU_UTILIZATION_CORE_SKEW_TURBO_ID).toBe('cpu-utilization.core-skew');
    expect(CPU_UTILIZATION_CORE_SKEW_TURBO_VERSION).toBe(1);
    expect(CPU_UTILIZATION_CORE_SKEW_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_UTILIZATION_CORE_SKEW_TRIGGERS)).toBe(true);
    const balanced = runCpuUtilizationCoreSkewTurbo([
      snapshot([{ utilizationPercent: 20 }, { utilizationPercent: 22 }]),
      snapshot([{ utilizationPercent: 30 }, { utilizationPercent: 31 }])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(balanced).toMatchObject({ sampleCount: 2, observedCount: 2,
      averageSkewPercent: 1.5, maximumSkewPercent: 2, dominantCoreChanges: 0,
      overloadedCoreSamples: 0, state: 'balanced', confidence: 1,
      recommendations: ['no-change'], actions: [] });
    const skewed = runCpuUtilizationCoreSkewTurbo([
      snapshot([{ utilizationPercent: 10 }, { utilizationPercent: 90 }]),
      snapshot([{ utilizationPercent: 20 }, { utilizationPercent: 80 }])
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(skewed).toMatchObject({ averageSkewPercent: 70, maximumSkewPercent: 80,
      overloadedCoreSamples: 1, state: 'high-skew',
      recommendations: ['review-core-contention', 'hold-affinity-change'] });
    expect(Object.isFrozen(balanced)).toBe(true);
    expect(Object.isFrozen(balanced.actions)).toBe(true);
  });

  test('detects dominant-core migration and preserves sparse evidence', () => {
    const migration = runCpuUtilizationCoreSkewTurbo([
      snapshot([{ utilizationPercent: 50 }, { utilizationPercent: 40 }]),
      snapshot([{ utilizationPercent: 40 }, { utilizationPercent: 50 }]),
      snapshot([{ utilizationPercent: 55 }, { utilizationPercent: 45 }])
    ], { trigger: 'system.facts.request', migrationThreshold: 2, now: () => 0 });
    expect(migration).toMatchObject({ dominantCoreChanges: 2, state: 'migration-watch',
      recommendations: ['observe-dominant-core-migration'] });
    const noObservation = runCpuUtilizationCoreSkewTurbo([
      snapshot(undefined), snapshot([{}])
    ], { trigger: 'health.interval', now: () => 0 });
    expect(noObservation).toMatchObject({ observedCount: 0, averageSkewPercent: null,
      maximumSkewPercent: null, dominantCoreChanges: 0, state: 'no-observation', confidence: 0,
      recommendations: ['request-core-utilization-observation'] });
    const insufficient = runCpuUtilizationCoreSkewTurbo([snapshot([{ utilizationPercent: 10 }])], {
      trigger: 'health.interval', now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5,
      recommendations: ['collect-more-core-samples'] });
  });

  test('bounds windows, thresholds, and utilization values', () => {
    const empty = runCpuUtilizationCoreSkewTurbo([], { trigger: 'health.interval', now: () => 0 });
    expect(empty).toMatchObject({ sampleCount: 0, state: 'insufficient-data', confidence: 0 });
    const bounded = runCpuUtilizationCoreSkewTurbo([
      snapshot([{ utilizationPercent: 1 }, { utilizationPercent: 2 }]),
      snapshot([{ utilizationPercent: 2 }, { utilizationPercent: 3 }]),
      snapshot([{ utilizationPercent: 120 }, { utilizationPercent: -5 }])
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2,
      skewThreshold: 100, overloadedThreshold: 90, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, averageSkewPercent: 50.5,
      maximumSkewPercent: 100, overloadedCoreSamples: 1 });
  });

  test('rejects malformed inputs, limits, thresholds, and clocks', () => {
    expect(() => runCpuUtilizationCoreSkewTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuUtilizationCoreSkewTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-utilization core-skew trigger: bad');
    expect(() => runCpuUtilizationCoreSkewTurbo()).toThrow('trigger: unknown');
    expect(() => runCpuUtilizationCoreSkewTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuUtilizationCoreSkewTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuUtilizationCoreSkewTurbo([], {
      trigger: 'health.interval', skewThreshold: 101
    })).toThrow('skewThreshold must be between 0 and 100');
    expect(() => runCpuUtilizationCoreSkewTurbo([], {
      trigger: 'health.interval', overloadedThreshold: -1
    })).toThrow('overloadedThreshold must be between 0 and 100');
    expect(() => runCpuUtilizationCoreSkewTurbo([], {
      trigger: 'health.interval', migrationThreshold: 0
    })).toThrow('migrationThreshold must be an integer from 1 to 64');
    expect(() => runCpuUtilizationCoreSkewTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuUtilizationCoreSkewTurbo([null, null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runCpuUtilizationCoreSkewTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuUtilizationCoreSkewTurbo([
      snapshot([], { cpu: null }), snapshot([], { cpu: null })
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
