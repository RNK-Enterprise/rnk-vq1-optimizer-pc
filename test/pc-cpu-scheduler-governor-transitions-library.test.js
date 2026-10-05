import {
  CPU_SCHEDULER_GOVERNOR_LIBRARY_ID,
  CPU_SCHEDULER_GOVERNOR_LIBRARY_VERSION,
  buildCpuSchedulerGovernorEnvelope,
  buildCpuSchedulerGovernorPlan,
  createCpuSchedulerGovernorLibrary,
  mergeCpuSchedulerGovernorReports
} from '../pc/engines/cpu-scheduler/turbos/governor-transitions/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-scheduler.governor-transitions',
    state: 'stable-governor',
    sampleCount: 4,
    observedCount: 4,
    unknownGovernorCount: 0,
    transitionCount: 1,
    transitionRate: 0.25,
    performanceCount: 1,
    powersaveCount: 1,
    schedutilCount: 2,
    powersaveUnderLoad: 0,
    ...overrides
  };
}

describe('CPU-scheduler governor-transitions library', () => {
  test('publishes identity and merges weighted governor evidence', () => {
    const merged = mergeCpuSchedulerGovernorReports([
      report({ state: 'transition-watch', sampleCount: 2, observedCount: 2,
        transitionCount: 1, transitionRate: 0.5, performanceCount: 1,
        powersaveCount: 1, schedutilCount: 0, powersaveUnderLoad: 0 }),
      report({ state: 'frequent-transition', sampleCount: 6, observedCount: 5,
        unknownGovernorCount: 1, transitionCount: 4, transitionRate: 0.6667,
        performanceCount: 2, powersaveCount: 2, schedutilCount: 1, powersaveUnderLoad: 2 })
    ]);
    expect(CPU_SCHEDULER_GOVERNOR_LIBRARY_ID).toBe('cpu-scheduler.governor-transitions.library');
    expect(CPU_SCHEDULER_GOVERNOR_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'frequent-transition',
      transitionRate: 0.625, transitionCount: 5, unknownGovernorCount: 1,
      performanceCount: 3, powersaveCount: 3, schedutilCount: 1,
      powersaveUnderLoad: 2, sampleCount: 8, observedCount: 7, confidence: 0.875,
      recommendations: ['observe-governor-transition-duration'] });
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuSchedulerGovernorReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0, recommendations: ['collect-more-governor-samples']
    });
    expect(mergeCpuSchedulerGovernorReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownGovernorCount: 0, transitionCount: 0, transitionRate: 0,
      performanceCount: 0, powersaveCount: 0, schedutilCount: 0, powersaveUnderLoad: 0 })]))
      .toMatchObject({ state: 'no-observation', confidence: 0,
        recommendations: ['request-governor-observation'] });
    expect(mergeCpuSchedulerGovernorReports([report({ state: 'powersave-under-load', powersaveUnderLoad: 2 })]))
      .toMatchObject({ state: 'powersave-under-load', recommendations: ['review-documented-governor-control'] });
    expect(mergeCpuSchedulerGovernorReports([report({ state: 'transition-watch' })]))
      .toMatchObject({ state: 'transition-watch', recommendations: ['observe-next-governor-sample'] });
    expect(mergeCpuSchedulerGovernorReports([report({ state: 'stable-governor' })]))
      .toMatchObject({ state: 'stable-governor', recommendations: ['no-change'] });
    expect(mergeCpuSchedulerGovernorReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownGovernorCount: 0, transitionCount: 0, transitionRate: 0,
      performanceCount: 0, powersaveCount: 0, schedutilCount: 0, powersaveUnderLoad: 0 })]))
      .toMatchObject({ state: 'insufficient-data' });
  });

  test('builds state-specific plans, envelopes, and a frozen factory', () => {
    expect(buildCpuSchedulerGovernorPlan(report({ state: 'powersave-under-load' }), 'interactive'))
      .toMatchObject({ mode: 'governor-control-review', intervalMs: 500 });
    expect(buildCpuSchedulerGovernorPlan(report({ state: 'frequent-transition' }), 'headless'))
      .toMatchObject({ mode: 'transition-observation', intervalMs: 750 });
    expect(buildCpuSchedulerGovernorPlan(report({ state: 'transition-watch' }), 'interactive'))
      .toMatchObject({ mode: 'trend-observation', intervalMs: 1000 });
    expect(buildCpuSchedulerGovernorPlan(report({ state: 'no-observation' }), 'interactive'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000 });
    expect(buildCpuSchedulerGovernorPlan(report({ state: 'insufficient-data' }), 'interactive'))
      .toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuSchedulerGovernorPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuSchedulerGovernorPlan(report({ observedCount: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
    const envelope = buildCpuSchedulerGovernorEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: CPU_SCHEDULER_GOVERNOR_LIBRARY_ID,
      trigger: 'health.interval', generatedAt: new Date(0).toISOString() });
    const factory = createCpuSchedulerGovernorLibrary();
    expect(Object.isFrozen(factory)).toBe(true);
    expect(factory.id).toBe(CPU_SCHEDULER_GOVERNOR_LIBRARY_ID);
    expect(factory.version).toBe(1);
    expect(factory.merge([])).toMatchObject({ state: 'insufficient-data' });
  });

  test('rejects malformed reports, limits, fields, triggers, and clocks', () => {
    expect(() => mergeCpuSchedulerGovernorReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuSchedulerGovernorReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuSchedulerGovernorReports([report({ turbo: 'other' })]))
      .toThrow('requires a governor-transitions turbo report');
    expect(() => mergeCpuSchedulerGovernorReports([report({ state: 'bad' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuSchedulerGovernorReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuSchedulerGovernorReports([report({ observedCount: 5 })]))
      .toThrow('observedCount must fit');
    expect(() => mergeCpuSchedulerGovernorReports([report({ unknownGovernorCount: 5 })]))
      .toThrow('unknown count must fit');
    expect(() => mergeCpuSchedulerGovernorReports([report({ transitionCount: 5 })]))
      .toThrow('transitionCount must fit');
    expect(() => mergeCpuSchedulerGovernorReports([report({ transitionRate: 2 })]))
      .toThrow('transitionRate must be between');
    expect(() => mergeCpuSchedulerGovernorReports([report({ performanceCount: 5 })]))
      .toThrow('performance count must fit');
    expect(() => mergeCpuSchedulerGovernorReports([report({ powersaveCount: 5 })]))
      .toThrow('powersave count must fit');
    expect(() => mergeCpuSchedulerGovernorReports([report({ schedutilCount: 5 })]))
      .toThrow('schedutil count must fit');
    expect(() => mergeCpuSchedulerGovernorReports([report({ powersaveUnderLoad: 5 })]))
      .toThrow('powersave-under-load count must fit');
    expect(() => buildCpuSchedulerGovernorEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuSchedulerGovernorEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => mergeCpuSchedulerGovernorReports([null])).toThrow('report must be an object');
  });
});
