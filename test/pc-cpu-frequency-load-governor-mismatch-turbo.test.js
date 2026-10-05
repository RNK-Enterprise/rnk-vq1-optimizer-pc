import {
  CPU_FREQUENCY_LOAD_TRIGGERS,
  CPU_FREQUENCY_LOAD_TURBO_ID,
  CPU_FREQUENCY_LOAD_TURBO_VERSION,
  runCpuFrequencyLoadGovernorMismatchTurbo
} from '../pc/engines/cpu-frequency/turbos/load-governor-mismatch/turbo.js';

function snapshot(governor, utilizationPercent, overrides = {}) {
  return { engine: 'system-facts', cpu: { governor, utilizationPercent }, ...overrides };
}

describe('CPU-frequency load-governor-mismatch turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_FREQUENCY_LOAD_TURBO_ID).toBe('cpu-frequency.load-governor-mismatch');
    expect(CPU_FREQUENCY_LOAD_TURBO_VERSION).toBe(1);
    expect(CPU_FREQUENCY_LOAD_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_FREQUENCY_LOAD_TRIGGERS)).toBe(true);
  });

  test('classifies aligned, powersave, performance, and mismatch states', () => {
    const aligned = runCpuFrequencyLoadGovernorMismatchTurbo([
      snapshot('schedutil', 20), snapshot('schedutil', 50), snapshot('schedutil', 80), snapshot('powersave', 20)
    ], { trigger: 'health.interval', mismatchCountThreshold: 3, now: () => 0 });
    expect(aligned).toMatchObject({ sampleCount: 4, observedCount: 4,
      powersaveUnderLoadCount: 0, performanceUnderIdleCount: 0, mismatchRate: 0,
      state: 'aligned-window', confidence: 1, recommendations: ['no-change'], actions: [] });

    const powersave = runCpuFrequencyLoadGovernorMismatchTurbo([
      snapshot('powersave', 80), snapshot('powersave', 90), snapshot('powersave', 70), snapshot('schedutil', 70)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(powersave).toMatchObject({ powersaveUnderLoadCount: 3, mismatchRate: 0.75,
      state: 'powersave-under-load', recommendations: ['review-documented-frequency-control'] });

    const performance = runCpuFrequencyLoadGovernorMismatchTurbo([
      snapshot('performance', 10), snapshot('performance', 20), snapshot('performance', 25), snapshot('schedutil', 20)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(performance).toMatchObject({ performanceUnderIdleCount: 3,
      state: 'performance-under-idle', recommendations: ['review-idle-frequency-control'] });

    const burst = runCpuFrequencyLoadGovernorMismatchTurbo([
      snapshot('powersave', 80), snapshot('performance', 20), snapshot('schedutil', 50), snapshot('schedutil', 50)
    ], { trigger: 'health.interval', mismatchCountThreshold: 3, now: () => 0 });
    expect(burst).toMatchObject({ mismatchRate: 0.5, state: 'mismatch-burst',
      recommendations: ['observe-load-governor-alignment'] });
    expect(Object.isFrozen(aligned)).toBe(true);
    expect(Object.isFrozen(aligned.actions)).toBe(true);
  });

  test('bounds windows and preserves sparse, empty, and unknown evidence', () => {
    const empty = runCpuFrequencyLoadGovernorMismatchTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-frequency-samples'] });

    const bounded = runCpuFrequencyLoadGovernorMismatchTurbo([
      snapshot('schedutil', 20), snapshot('powersave', 80), snapshot('performance', 20), snapshot('schedutil', 50)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, observedCount: 2, mismatchRate: 0.5 });

    const insufficient = runCpuFrequencyLoadGovernorMismatchTurbo([snapshot('schedutil', 20)], {
      trigger: 'health.interval', minimumSamples: 2, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const unknown = runCpuFrequencyLoadGovernorMismatchTurbo([
      snapshot(null, null), snapshot('', 'bad')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2,
      mismatchRate: 0, state: 'no-observation', confidence: 0,
      recommendations: ['request-load-governor-observation'] });

    const normalized = runCpuFrequencyLoadGovernorMismatchTurbo([
      snapshot(' POWERSAVE ', 120), snapshot('performance', -10)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(normalized).toMatchObject({ observedCount: 2, powersaveUnderLoadCount: 1,
      performanceUnderIdleCount: 1, mismatchRate: 1 });
  });

  test('rejects malformed inputs, limits, thresholds, snapshots, and clocks', () => {
    expect(() => runCpuFrequencyLoadGovernorMismatchTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuFrequencyLoadGovernorMismatchTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-frequency load-governor-mismatch trigger: bad');
    expect(() => runCpuFrequencyLoadGovernorMismatchTurbo())
      .toThrow('Unsupported CPU-frequency load-governor-mismatch trigger: unknown');
    expect(() => runCpuFrequencyLoadGovernorMismatchTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuFrequencyLoadGovernorMismatchTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuFrequencyLoadGovernorMismatchTurbo([], {
      trigger: 'health.interval', mismatchCountThreshold: 65
    })).toThrow('mismatchCountThreshold must be an integer from 1 to 64');
    expect(() => runCpuFrequencyLoadGovernorMismatchTurbo([], {
      trigger: 'health.interval', mismatchRateThreshold: 1.1
    })).toThrow('mismatchRateThreshold must be between 0 and 1');
    expect(() => runCpuFrequencyLoadGovernorMismatchTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuFrequencyLoadGovernorMismatchTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runCpuFrequencyLoadGovernorMismatchTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuFrequencyLoadGovernorMismatchTurbo([
      snapshot('schedutil', 20, { cpu: null }), snapshot('schedutil', 20)
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
