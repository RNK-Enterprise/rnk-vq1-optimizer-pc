import {
  CPU_FREQUENCY_POLICY_TRIGGERS,
  CPU_FREQUENCY_POLICY_TURBO_ID,
  CPU_FREQUENCY_POLICY_TURBO_VERSION,
  runCpuFrequencyPolicyShiftTurbo
} from '../pc/engines/cpu-frequency/turbos/policy-shift/turbo.js';

function snapshot(governor, driver, overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: { governor, driver },
    ...overrides
  };
}

describe('CPU-frequency policy-shift turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_FREQUENCY_POLICY_TURBO_ID).toBe('cpu-frequency.policy-shift');
    expect(CPU_FREQUENCY_POLICY_TURBO_VERSION).toBe(1);
    expect(CPU_FREQUENCY_POLICY_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_FREQUENCY_POLICY_TRIGGERS)).toBe(true);
  });

  test('classifies stable, frequent, unsupported, and policy-watch states', () => {
    const stable = runCpuFrequencyPolicyShiftTurbo([
      snapshot('schedutil', 'intel_pstate'), snapshot('schedutil', 'intel_pstate'),
      snapshot('schedutil', 'intel_pstate')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(stable).toMatchObject({ sampleCount: 3, observedCount: 3, unknownCount: 0,
      unsupportedCount: 0, comparisonCount: 2, changeCount: 0, changeRate: 0,
      state: 'stable-policy', confidence: 1, recommendations: ['no-change'], actions: [] });

    const frequent = runCpuFrequencyPolicyShiftTurbo([
      snapshot('performance', 'intel_pstate'), snapshot('powersave', 'amd_pstate'),
      snapshot('schedutil', 'acpi-cpufreq'), snapshot('performance', 'intel_pstate')
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(frequent).toMatchObject({ comparisonCount: 3, changeCount: 3, changeRate: 1,
      state: 'frequent-shift', recommendations: ['observe-frequency-policy-duration'] });

    const unsupported = runCpuFrequencyPolicyShiftTurbo([
      snapshot('vendor-governor', 'intel_pstate'), snapshot('schedutil', 'vendor-driver')
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(unsupported).toMatchObject({ observedCount: 2, unsupportedCount: 2,
      state: 'unsupported-policy', recommendations: ['review-undocumented-frequency-control'] });

    const watch = runCpuFrequencyPolicyShiftTurbo([
      snapshot('performance', 'intel_pstate'), snapshot('powersave', 'intel_pstate'),
      snapshot('powersave', 'intel_pstate'), snapshot('powersave', 'intel_pstate')
    ], { trigger: 'health.interval', changeThreshold: 3, changeRateThreshold: 0.3, now: () => 0 });
    expect(watch).toMatchObject({ comparisonCount: 3, changeCount: 1, changeRate: 0.3333,
      state: 'policy-watch', recommendations: ['observe-next-frequency-sample'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows and preserves sparse, empty, and unknown evidence', () => {
    const empty = runCpuFrequencyPolicyShiftTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-frequency-samples'] });

    const bounded = runCpuFrequencyPolicyShiftTurbo([
      snapshot('performance', 'intel_pstate'), snapshot('powersave', 'amd_pstate'),
      snapshot('schedutil', 'acpi-cpufreq'), snapshot('performance', 'intel_pstate')
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, comparisonCount: 1, changeCount: 1 });

    const insufficient = runCpuFrequencyPolicyShiftTurbo([snapshot('schedutil', 'intel_pstate')], {
      trigger: 'health.interval', minimumSamples: 2, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const unknown = runCpuFrequencyPolicyShiftTurbo([
      snapshot(null, null), snapshot('', '')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2,
      unsupportedCount: 1, comparisonCount: 0, changeCount: 0,
      state: 'no-observation', confidence: 0,
      recommendations: ['request-frequency-policy-observation'] });

    const normalized = runCpuFrequencyPolicyShiftTurbo([
      snapshot(' PERFORMANCE ', ' INTEL_PSTATE '), snapshot('powersave', 'amd_pstate')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(normalized).toMatchObject({ observedCount: 2, unsupportedCount: 0, changeCount: 1 });
  });

  test('rejects malformed inputs, limits, thresholds, snapshots, and clocks', () => {
    expect(() => runCpuFrequencyPolicyShiftTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuFrequencyPolicyShiftTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-frequency policy-shift trigger: bad');
    expect(() => runCpuFrequencyPolicyShiftTurbo())
      .toThrow('Unsupported CPU-frequency policy-shift trigger: unknown');
    expect(() => runCpuFrequencyPolicyShiftTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuFrequencyPolicyShiftTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuFrequencyPolicyShiftTurbo([], {
      trigger: 'health.interval', changeThreshold: 65
    })).toThrow('changeThreshold must be an integer from 1 to 64');
    expect(() => runCpuFrequencyPolicyShiftTurbo([], {
      trigger: 'health.interval', changeRateThreshold: 1.1
    })).toThrow('changeRateThreshold must be between 0 and 1');
    expect(() => runCpuFrequencyPolicyShiftTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuFrequencyPolicyShiftTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runCpuFrequencyPolicyShiftTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuFrequencyPolicyShiftTurbo([
      snapshot('schedutil', 'intel_pstate', { cpu: null }), snapshot('schedutil', 'intel_pstate')
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
