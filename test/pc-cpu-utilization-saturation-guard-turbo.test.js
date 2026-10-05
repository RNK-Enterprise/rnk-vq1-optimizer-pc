import {
  CPU_UTILIZATION_SATURATION_TRIGGERS,
  CPU_UTILIZATION_SATURATION_TURBO_ID,
  CPU_UTILIZATION_SATURATION_TURBO_VERSION,
  runCpuUtilizationSaturationGuardTurbo
} from '../pc/engines/cpu-utilization/turbos/saturation-guard/turbo.js';

function snapshot(utilizationPercent, overrides = {}) {
  return { engine: 'system-facts', cpu: { utilizationPercent }, ...overrides };
}

describe('CPU-utilization saturation-guard turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_UTILIZATION_SATURATION_TURBO_ID).toBe('cpu-utilization.saturation-guard');
    expect(CPU_UTILIZATION_SATURATION_TURBO_VERSION).toBe(1);
    expect(CPU_UTILIZATION_SATURATION_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_UTILIZATION_SATURATION_TRIGGERS)).toBe(true);
  });

  test('classifies clear, intermittent, sustained, and recovery windows', () => {
    const clear = runCpuUtilizationSaturationGuardTurbo([
      snapshot(20), snapshot(30), snapshot(40), snapshot(50)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(clear).toMatchObject({ saturationCount: 0, longestSaturationRun: 0,
      trailingSaturationRun: 0, recoveryTransitions: 0, state: 'clear', confidence: 1,
      recommendations: ['no-change'], actions: [] });
    const intermittent = runCpuUtilizationSaturationGuardTurbo([
      snapshot(90), snapshot(70), snapshot(91), snapshot(70)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(intermittent).toMatchObject({ saturationCount: 2, longestSaturationRun: 1,
      state: 'intermittent-saturation', recommendations: ['observe-next-cpu-sample'] });
    const sustained = runCpuUtilizationSaturationGuardTurbo([
      snapshot(90), snapshot(95), snapshot(100), snapshot(40)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(sustained).toMatchObject({ saturationCount: 3, longestSaturationRun: 3,
      trailingSaturationRun: 0, state: 'sustained-saturation',
      recommendations: ['protect-foreground', 'hold-unapproved-policy-change'] });
    const recovery = runCpuUtilizationSaturationGuardTurbo([
      snapshot(90), snapshot(40), snapshot(30), snapshot(40)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(recovery).toMatchObject({ saturationCount: 1, recoveryTransitions: 1,
      state: 'recovery-observed', recommendations: ['observe-recovery-window'] });
  });

  test('bounds windows and preserves sparse, empty, and insufficient evidence', () => {
    const empty = runCpuUtilizationSaturationGuardTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0,
      state: 'insufficient-data', confidence: 0, recommendations: ['collect-more-cpu-samples'] });
    const insufficient = runCpuUtilizationSaturationGuardTurbo([snapshot(90)], {
      trigger: 'health.interval', minimumSamples: 3, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, saturationCount: 1,
      state: 'insufficient-data', confidence: 0.3333 });
    const unknown = runCpuUtilizationSaturationGuardTurbo([
      snapshot('bad'), snapshot(null), snapshot(undefined)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, saturationCount: 0,
      state: 'no-observation', confidence: 0,
      recommendations: ['request-cpu-utilization-observation'] });
    const bounded = runCpuUtilizationSaturationGuardTurbo([
      snapshot(1), snapshot(2), snapshot(3), snapshot(90), snapshot(95)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, saturationCount: 2, longestSaturationRun: 2 });
    expect(Object.isFrozen(bounded)).toBe(true);
    expect(Object.isFrozen(bounded.actions)).toBe(true);
  });

  test('rejects malformed inputs, limits, thresholds, and clocks', () => {
    expect(() => runCpuUtilizationSaturationGuardTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuUtilizationSaturationGuardTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-utilization saturation-guard trigger: bad');
    expect(() => runCpuUtilizationSaturationGuardTurbo()).toThrow('trigger: unknown');
    expect(() => runCpuUtilizationSaturationGuardTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuUtilizationSaturationGuardTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuUtilizationSaturationGuardTurbo([], {
      trigger: 'health.interval', saturationThreshold: 101
    })).toThrow('saturationThreshold must be between 0 and 100');
    expect(() => runCpuUtilizationSaturationGuardTurbo([], {
      trigger: 'health.interval', recoveryThreshold: -1
    })).toThrow('recoveryThreshold must be between 0 and 100');
    expect(() => runCpuUtilizationSaturationGuardTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuUtilizationSaturationGuardTurbo([null, null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runCpuUtilizationSaturationGuardTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuUtilizationSaturationGuardTurbo([
      snapshot(10, { cpu: null }), snapshot(10, { cpu: null })
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
