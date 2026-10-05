import {
  CPU_UTILIZATION_TREND_TRIGGERS,
  CPU_UTILIZATION_TREND_TURBO_ID,
  CPU_UTILIZATION_TREND_TURBO_VERSION,
  runCpuUtilizationTrendSlopeTurbo
} from '../pc/engines/cpu-utilization/turbos/trend-slope/turbo.js';

function snapshot(utilizationPercent, overrides = {}) {
  return { engine: 'system-facts', cpu: { utilizationPercent }, ...overrides };
}

describe('CPU-utilization trend-slope turbo', () => {
  test('publishes immutable identity and classifies rising, falling, and flat trends', () => {
    expect(CPU_UTILIZATION_TREND_TURBO_ID).toBe('cpu-utilization.trend-slope');
    expect(CPU_UTILIZATION_TREND_TURBO_VERSION).toBe(1);
    expect(CPU_UTILIZATION_TREND_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_UTILIZATION_TREND_TRIGGERS)).toBe(true);
    const rising = runCpuUtilizationTrendSlopeTurbo([
      snapshot(10), snapshot(20), snapshot(30), snapshot(40)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(rising).toMatchObject({ observedCount: 4, meanUtilizationPercent: 25,
      slopePercentPerSample: 10, rangePercent: 30, state: 'rising-trend', confidence: 1,
      recommendations: ['observe-rising-cpu-demand'], actions: [] });
    const falling = runCpuUtilizationTrendSlopeTurbo([
      snapshot(40), snapshot(30), snapshot(20), snapshot(10)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(falling).toMatchObject({ slopePercentPerSample: -10, state: 'falling-trend',
      recommendations: ['observe-falling-cpu-demand'] });
    const flat = runCpuUtilizationTrendSlopeTurbo([
      snapshot(20), snapshot(22), snapshot(21), snapshot(20)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(flat).toMatchObject({ state: 'flat-window', recommendations: ['no-change'] });
    expect(Object.isFrozen(rising)).toBe(true);
    expect(Object.isFrozen(rising.actions)).toBe(true);
  });

  test('classifies volatility and preserves sparse evidence', () => {
    const volatile = runCpuUtilizationTrendSlopeTurbo([
      snapshot(10), snapshot(90), snapshot(10), snapshot(90)
    ], { trigger: 'workload.changed', slopeThreshold: 50, volatilityThreshold: 50, now: () => 0 });
    expect(volatile).toMatchObject({ slopePercentPerSample: 16, rangePercent: 80,
      state: 'volatile-window', recommendations: ['observe-volatility-before-policy-review'] });
    const unknown = runCpuUtilizationTrendSlopeTurbo([
      snapshot('bad'), snapshot(null)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, meanUtilizationPercent: null,
      slopePercentPerSample: null, rangePercent: null, state: 'no-observation', confidence: 0,
      recommendations: ['request-cpu-utilization-observation'] });
    const sparse = runCpuUtilizationTrendSlopeTurbo([
      snapshot(null), snapshot(20), snapshot(null), snapshot(40)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(sparse).toMatchObject({ observedCount: 2, meanUtilizationPercent: 30,
      slopePercentPerSample: 10, rangePercent: 20 });
  });

  test('bounds windows and preserves empty and insufficient samples', () => {
    const empty = runCpuUtilizationTrendSlopeTurbo([], { trigger: 'health.interval', now: () => 0 });
    expect(empty).toMatchObject({ sampleCount: 0, state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-cpu-samples'] });
    const insufficient = runCpuUtilizationTrendSlopeTurbo([snapshot(40)], {
      trigger: 'health.interval', minimumSamples: 2, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });
    const bounded = runCpuUtilizationTrendSlopeTurbo([
      snapshot(1), snapshot(2), snapshot(10), snapshot(20)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, meanUtilizationPercent: 15,
      slopePercentPerSample: 10, rangePercent: 10 });
  });

  test('rejects malformed inputs, limits, thresholds, and clocks', () => {
    expect(() => runCpuUtilizationTrendSlopeTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuUtilizationTrendSlopeTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-utilization trend-slope trigger: bad');
    expect(() => runCpuUtilizationTrendSlopeTurbo()).toThrow('trigger: unknown');
    expect(() => runCpuUtilizationTrendSlopeTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuUtilizationTrendSlopeTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuUtilizationTrendSlopeTurbo([], {
      trigger: 'health.interval', slopeThreshold: 101
    })).toThrow('slopeThreshold must be between 0 and 100');
    expect(() => runCpuUtilizationTrendSlopeTurbo([], {
      trigger: 'health.interval', volatilityThreshold: -1
    })).toThrow('volatilityThreshold must be between 0 and 100');
    expect(() => runCpuUtilizationTrendSlopeTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuUtilizationTrendSlopeTurbo([null, null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runCpuUtilizationTrendSlopeTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuUtilizationTrendSlopeTurbo([
      snapshot(10, { cpu: null }), snapshot(10, { cpu: null })
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
