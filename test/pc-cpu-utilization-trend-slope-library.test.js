import {
  CPU_UTILIZATION_TREND_LIBRARY_ID,
  CPU_UTILIZATION_TREND_LIBRARY_VERSION,
  buildCpuUtilizationTrendEnvelope,
  buildCpuUtilizationTrendPlan,
  createCpuUtilizationTrendLibrary,
  mergeCpuUtilizationTrendReports
} from '../pc/engines/cpu-utilization/turbos/trend-slope/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-utilization.trend-slope',
    state: 'flat-window',
    sampleCount: 4,
    observedCount: 4,
    meanUtilizationPercent: 50,
    slopePercentPerSample: 0,
    rangePercent: 8,
    ...overrides
  };
}

describe('CPU-utilization trend-slope library', () => {
  test('publishes identity and merges bounded trend reports', () => {
    const merged = mergeCpuUtilizationTrendReports([
      report({ state: 'rising-trend', sampleCount: 2, observedCount: 2,
        meanUtilizationPercent: 30, slopePercentPerSample: 10, rangePercent: 20 }),
      report({ state: 'falling-trend', sampleCount: 6, observedCount: 5,
        meanUtilizationPercent: 70, slopePercentPerSample: -5, rangePercent: 60 })
    ]);
    expect(merged).toMatchObject({
      library: CPU_UTILIZATION_TREND_LIBRARY_ID,
      libraryVersion: CPU_UTILIZATION_TREND_LIBRARY_VERSION,
      reportCount: 2, state: 'rising-trend', meanUtilizationPercent: 60,
      slopePercentPerSample: -1.25, rangePercent: 60, sampleCount: 8,
      observedCount: 7, confidence: 0.875, recommendations: ['observe-rising-cpu-demand']
    });
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(createCpuUtilizationTrendLibrary())).toBe(true);
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuUtilizationTrendReports([report()])).toMatchObject({
      state: 'flat-window', recommendations: ['no-change']
    });
    expect(mergeCpuUtilizationTrendReports([])).toMatchObject({
      reportCount: 0, state: 'insufficient-data', meanUtilizationPercent: null,
      slopePercentPerSample: null, rangePercent: null, sampleCount: 0,
      observedCount: 0, confidence: 0, recommendations: ['collect-more-cpu-samples']
    });
    expect(mergeCpuUtilizationTrendReports([report({ state: 'falling-trend', slopePercentPerSample: -10 })]))
      .toMatchObject({ state: 'falling-trend', recommendations: ['observe-falling-cpu-demand'] });
    expect(mergeCpuUtilizationTrendReports([report({ state: 'volatile-window', rangePercent: 80 })]))
      .toMatchObject({ state: 'volatile-window', recommendations: ['observe-volatility-before-policy-review'] });
    expect(mergeCpuUtilizationTrendReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, meanUtilizationPercent: null, slopePercentPerSample: null, rangePercent: null })]))
      .toMatchObject({ state: 'no-observation', confidence: 0,
        recommendations: ['request-cpu-utilization-observation'] });
    expect(mergeCpuUtilizationTrendReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 1 })])).toMatchObject({ state: 'insufficient-data', confidence: 1 });
  });

  test('builds state-specific plans and immutable envelopes', () => {
    expect(buildCpuUtilizationTrendPlan(report({ state: 'rising-trend' }), 'interactive'))
      .toMatchObject({ environment: 'interactive', mode: 'rising-observation', intervalMs: 500, confidence: 1 });
    expect(buildCpuUtilizationTrendPlan(report({ state: 'falling-trend' }), 'headless'))
      .toMatchObject({ mode: 'falling-observation', intervalMs: 750 });
    expect(buildCpuUtilizationTrendPlan(report({ state: 'volatile-window' }), 'headless'))
      .toMatchObject({ mode: 'volatility-observation', intervalMs: 1000 });
    expect(buildCpuUtilizationTrendPlan(report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, meanUtilizationPercent: null, slopePercentPerSample: null, rangePercent: null }), 'headless'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000, confidence: 0 });
    expect(buildCpuUtilizationTrendPlan(report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 1 }), 'interactive')).toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuUtilizationTrendPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuUtilizationTrendPlan(report(), 'unclassified')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', intervalMs: 5000
    });
    const envelope = buildCpuUtilizationTrendEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
  });

  test('rejects malformed reports, collections, triggers, clocks, and limits', () => {
    expect(() => mergeCpuUtilizationTrendReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuUtilizationTrendReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuUtilizationTrendReports([null])).toThrow('report must be an object');
    expect(() => mergeCpuUtilizationTrendReports([report({ turbo: 'other' })]))
      .toThrow('requires a trend-slope turbo report');
    expect(() => mergeCpuUtilizationTrendReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuUtilizationTrendReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuUtilizationTrendReports([report({ observedCount: 5 })]))
      .toThrow('observedCount must fit');
    expect(() => mergeCpuUtilizationTrendReports([report({ meanUtilizationPercent: 101 })]))
      .toThrow('mean must be null or between');
    expect(() => mergeCpuUtilizationTrendReports([report({ slopePercentPerSample: -101 })]))
      .toThrow('slope must be null or between');
    expect(() => mergeCpuUtilizationTrendReports([report({ rangePercent: 101 })]))
      .toThrow('range must be null or between');
    expect(() => buildCpuUtilizationTrendEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuUtilizationTrendEnvelope(report(), { trigger: '', now: () => 0 }))
      .toThrow('trigger is required');
    expect(() => buildCpuUtilizationTrendEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
