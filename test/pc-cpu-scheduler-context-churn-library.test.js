import {
  CPU_SCHEDULER_CHURN_LIBRARY_ID,
  CPU_SCHEDULER_CHURN_LIBRARY_VERSION,
  buildCpuSchedulerContextChurnEnvelope,
  buildCpuSchedulerContextChurnPlan,
  createCpuSchedulerContextChurnLibrary,
  mergeCpuSchedulerContextChurnReports
} from '../pc/engines/cpu-scheduler/turbos/context-churn/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-scheduler.context-churn',
    state: 'stable-churn',
    sampleCount: 4,
    observedCount: 4,
    highRateCount: 1,
    highRateFraction: 0.25,
    peakSwitchRate: 2,
    meanSwitchRate: 1,
    maximumDelta: 0.5,
    reversalCount: 1,
    ...overrides
  };
}

describe('CPU-scheduler context-churn library', () => {
  test('publishes identity and merges weighted churn evidence', () => {
    const merged = mergeCpuSchedulerContextChurnReports([
      report({ state: 'reversal-watch', sampleCount: 2, observedCount: 2,
        highRateCount: 0, highRateFraction: 0, peakSwitchRate: 2, meanSwitchRate: 0.5,
        maximumDelta: 1, reversalCount: 2 }),
      report({ state: 'high-churn', sampleCount: 6, observedCount: 5,
        highRateCount: 4, highRateFraction: 0.5, peakSwitchRate: 4, meanSwitchRate: 2,
        maximumDelta: 2, reversalCount: 3 })
    ]);
    expect(CPU_SCHEDULER_CHURN_LIBRARY_ID).toBe('cpu-scheduler.context-churn.library');
    expect(CPU_SCHEDULER_CHURN_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'high-churn',
      highRateFraction: 0.375, peakSwitchRate: 4, meanSwitchRate: 1.625,
      maximumDelta: 2, reversalCount: 3, sampleCount: 8, observedCount: 7,
      highRateCount: 4, confidence: 0.875,
      recommendations: ['observe-scheduler-churn-duration'] });
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuSchedulerContextChurnReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-context-switch-samples']
    });
    expect(mergeCpuSchedulerContextChurnReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, highRateCount: 0, highRateFraction: 0, peakSwitchRate: null,
      meanSwitchRate: null, maximumDelta: 0, reversalCount: 0 })])).toMatchObject({
      state: 'no-observation', confidence: 0,
      recommendations: ['request-context-switch-observation']
    });
    expect(mergeCpuSchedulerContextChurnReports([report({ state: 'volatile-churn' })]))
      .toMatchObject({ state: 'volatile-churn', recommendations: ['observe-context-switch-volatility'] });
    expect(mergeCpuSchedulerContextChurnReports([report({ state: 'reversal-watch' })]))
      .toMatchObject({ state: 'reversal-watch', recommendations: ['observe-next-churn-sample'] });
    expect(mergeCpuSchedulerContextChurnReports([report({ state: 'stable-churn' })]))
      .toMatchObject({ state: 'stable-churn', recommendations: ['no-change'] });
    expect(mergeCpuSchedulerContextChurnReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, highRateCount: 0, highRateFraction: 0, peakSwitchRate: null,
      meanSwitchRate: null, maximumDelta: 0, reversalCount: 0 })])).toMatchObject({
      state: 'insufficient-data'
    });
  });

  test('builds state-specific plans, envelopes, and a frozen factory', () => {
    expect(buildCpuSchedulerContextChurnPlan(report({ state: 'volatile-churn' }), 'interactive'))
      .toMatchObject({ mode: 'volatility-observation', intervalMs: 250 });
    expect(buildCpuSchedulerContextChurnPlan(report({ state: 'high-churn' }), 'headless'))
      .toMatchObject({ mode: 'churn-observation', intervalMs: 500 });
    expect(buildCpuSchedulerContextChurnPlan(report({ state: 'reversal-watch' }), 'interactive'))
      .toMatchObject({ mode: 'reversal-observation', intervalMs: 750 });
    expect(buildCpuSchedulerContextChurnPlan(report({ state: 'no-observation' }), 'interactive'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000 });
    expect(buildCpuSchedulerContextChurnPlan(report({ state: 'insufficient-data' }), 'interactive'))
      .toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuSchedulerContextChurnPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuSchedulerContextChurnPlan(report({ observedCount: 0, highRateCount: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
    const envelope = buildCpuSchedulerContextChurnEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: CPU_SCHEDULER_CHURN_LIBRARY_ID,
      trigger: 'health.interval', generatedAt: new Date(0).toISOString() });
    const factory = createCpuSchedulerContextChurnLibrary();
    expect(Object.isFrozen(factory)).toBe(true);
    expect(factory.id).toBe(CPU_SCHEDULER_CHURN_LIBRARY_ID);
    expect(factory.version).toBe(1);
    expect(factory.merge([])).toMatchObject({ state: 'insufficient-data' });
  });

  test('rejects malformed reports, limits, fields, triggers, and clocks', () => {
    expect(() => mergeCpuSchedulerContextChurnReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuSchedulerContextChurnReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuSchedulerContextChurnReports([report({ turbo: 'other' })]))
      .toThrow('requires a context-churn turbo report');
    expect(() => mergeCpuSchedulerContextChurnReports([report({ state: 'bad' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuSchedulerContextChurnReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuSchedulerContextChurnReports([report({ observedCount: 5 })]))
      .toThrow('observedCount must fit');
    expect(() => mergeCpuSchedulerContextChurnReports([report({ highRateCount: 5 })]))
      .toThrow('highRateCount must fit');
    expect(() => mergeCpuSchedulerContextChurnReports([report({ highRateFraction: 2 })]))
      .toThrow('highRateFraction must be between');
    expect(() => mergeCpuSchedulerContextChurnReports([report({ peakSwitchRate: 17 })]))
      .toThrow('peak must be null or between');
    expect(() => mergeCpuSchedulerContextChurnReports([report({ meanSwitchRate: -1 })]))
      .toThrow('mean must be null or between');
    expect(() => mergeCpuSchedulerContextChurnReports([report({ maximumDelta: 17 })]))
      .toThrow('maximumDelta must be between');
    expect(() => mergeCpuSchedulerContextChurnReports([report({ reversalCount: 5 })]))
      .toThrow('reversalCount must fit');
    expect(() => buildCpuSchedulerContextChurnEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuSchedulerContextChurnEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => mergeCpuSchedulerContextChurnReports([null])).toThrow('report must be an object');
  });
});
