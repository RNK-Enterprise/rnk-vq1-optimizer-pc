import {
  CPU_FREQUENCY_POLICY_LIBRARY_ID,
  CPU_FREQUENCY_POLICY_LIBRARY_VERSION,
  buildCpuFrequencyPolicyEnvelope,
  buildCpuFrequencyPolicyPlan,
  createCpuFrequencyPolicyLibrary,
  mergeCpuFrequencyPolicyReports
} from '../pc/engines/cpu-frequency/turbos/policy-shift/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-frequency.policy-shift',
    state: 'stable-policy',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    unsupportedCount: 0,
    comparisonCount: 3,
    changeCount: 1,
    changeRate: 0.3333,
    ...overrides
  };
}

describe('CPU-frequency policy-shift library', () => {
  test('publishes identity and merges weighted policy evidence', () => {
    const merged = mergeCpuFrequencyPolicyReports([
      report({ state: 'policy-watch', sampleCount: 2, observedCount: 2,
        comparisonCount: 1, changeCount: 1, changeRate: 0.5 }),
      report({ state: 'frequent-shift', sampleCount: 6, observedCount: 5,
        unknownCount: 1, comparisonCount: 5, changeCount: 4, changeRate: 0.8 })
    ]);
    expect(CPU_FREQUENCY_POLICY_LIBRARY_ID).toBe('cpu-frequency.policy-shift.library');
    expect(CPU_FREQUENCY_POLICY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'frequent-shift',
      observedCount: 7, unknownCount: 1, unsupportedCount: 0, comparisonCount: 6,
      changeCount: 5, changeRate: 0.725, sampleCount: 8, confidence: 0.875,
      recommendations: ['observe-frequency-policy-duration'] });
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuFrequencyPolicyReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0, recommendations: ['collect-more-frequency-samples']
    });
    expect(mergeCpuFrequencyPolicyReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, unsupportedCount: 0, comparisonCount: 0,
      changeCount: 0, changeRate: 0 })])).toMatchObject({ state: 'no-observation', confidence: 0,
      recommendations: ['request-frequency-policy-observation'] });
    expect(mergeCpuFrequencyPolicyReports([report({ state: 'unsupported-policy', unsupportedCount: 1 })]))
      .toMatchObject({ state: 'unsupported-policy', recommendations: ['review-undocumented-frequency-control'] });
    expect(mergeCpuFrequencyPolicyReports([report({ state: 'frequent-shift' })]))
      .toMatchObject({ state: 'frequent-shift', recommendations: ['observe-frequency-policy-duration'] });
    expect(mergeCpuFrequencyPolicyReports([report({ state: 'policy-watch' })]))
      .toMatchObject({ state: 'policy-watch', recommendations: ['observe-next-frequency-sample'] });
    expect(mergeCpuFrequencyPolicyReports([report({ state: 'stable-policy' })]))
      .toMatchObject({ state: 'stable-policy', recommendations: ['no-change'] });
    expect(mergeCpuFrequencyPolicyReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, unsupportedCount: 0, comparisonCount: 0,
      changeCount: 0, changeRate: 0 })])).toMatchObject({ state: 'insufficient-data' });
  });

  test('builds state-specific plans, envelopes, and a frozen factory', () => {
    expect(buildCpuFrequencyPolicyPlan(report({ state: 'unsupported-policy' }), 'interactive'))
      .toMatchObject({ mode: 'policy-review', intervalMs: 500 });
    expect(buildCpuFrequencyPolicyPlan(report({ state: 'frequent-shift' }), 'headless'))
      .toMatchObject({ mode: 'change-observation', intervalMs: 750 });
    expect(buildCpuFrequencyPolicyPlan(report({ state: 'policy-watch' }), 'interactive'))
      .toMatchObject({ mode: 'trend-observation', intervalMs: 1000 });
    expect(buildCpuFrequencyPolicyPlan(report({ state: 'no-observation' }), 'interactive'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000 });
    expect(buildCpuFrequencyPolicyPlan(report({ state: 'insufficient-data' }), 'interactive'))
      .toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuFrequencyPolicyPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuFrequencyPolicyPlan(report({ observedCount: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
    const envelope = buildCpuFrequencyPolicyEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: CPU_FREQUENCY_POLICY_LIBRARY_ID,
      trigger: 'health.interval', generatedAt: new Date(0).toISOString() });
    const factory = createCpuFrequencyPolicyLibrary();
    expect(Object.isFrozen(factory)).toBe(true);
    expect(factory.id).toBe(CPU_FREQUENCY_POLICY_LIBRARY_ID);
    expect(factory.version).toBe(1);
    expect(factory.merge([])).toMatchObject({ state: 'insufficient-data' });
  });

  test('rejects malformed reports, limits, fields, triggers, and clocks', () => {
    expect(() => mergeCpuFrequencyPolicyReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuFrequencyPolicyReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuFrequencyPolicyReports([report({ turbo: 'other' })]))
      .toThrow('requires a policy-shift turbo report');
    expect(() => mergeCpuFrequencyPolicyReports([report({ state: 'bad' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuFrequencyPolicyReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuFrequencyPolicyReports([report({ observedCount: 5 })]))
      .toThrow('observed count must fit');
    expect(() => mergeCpuFrequencyPolicyReports([report({ unknownCount: 5 })]))
      .toThrow('unknown count must fit');
    expect(() => mergeCpuFrequencyPolicyReports([report({ unsupportedCount: 5 })]))
      .toThrow('unsupported count must fit');
    expect(() => mergeCpuFrequencyPolicyReports([report({ comparisonCount: 5 })]))
      .toThrow('comparison count must fit');
    expect(() => mergeCpuFrequencyPolicyReports([report({ changeCount: 5 })]))
      .toThrow('change count must fit');
    expect(() => mergeCpuFrequencyPolicyReports([report({ changeRate: 2 })]))
      .toThrow('changeRate must be between');
    expect(() => buildCpuFrequencyPolicyEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuFrequencyPolicyEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => mergeCpuFrequencyPolicyReports([null])).toThrow('report must be an object');
  });
});
