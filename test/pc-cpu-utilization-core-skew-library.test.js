import {
  CPU_UTILIZATION_CORE_SKEW_LIBRARY_ID,
  CPU_UTILIZATION_CORE_SKEW_LIBRARY_VERSION,
  buildCpuUtilizationCoreSkewEnvelope,
  buildCpuUtilizationCoreSkewPlan,
  createCpuUtilizationCoreSkewLibrary,
  mergeCpuUtilizationCoreSkewReports
} from '../pc/engines/cpu-utilization/turbos/core-skew/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-utilization.core-skew',
    state: 'balanced',
    sampleCount: 4,
    observedCount: 4,
    averageSkewPercent: 5,
    maximumSkewPercent: 8,
    dominantCoreChanges: 0,
    overloadedCoreSamples: 0,
    ...overrides
  };
}

describe('CPU-utilization core-skew library', () => {
  test('publishes identity and merges bounded skew reports', () => {
    const merged = mergeCpuUtilizationCoreSkewReports([
      report({ state: 'migration-watch', sampleCount: 2, observedCount: 2,
        averageSkewPercent: 10, maximumSkewPercent: 20, dominantCoreChanges: 2 }),
      report({ state: 'high-skew', sampleCount: 6, observedCount: 5,
        averageSkewPercent: 70, maximumSkewPercent: 90, overloadedCoreSamples: 4 })
    ]);
    expect(merged).toMatchObject({
      library: CPU_UTILIZATION_CORE_SKEW_LIBRARY_ID,
      libraryVersion: CPU_UTILIZATION_CORE_SKEW_LIBRARY_VERSION,
      reportCount: 2, state: 'high-skew', averageSkewPercent: 55,
      maximumSkewPercent: 90, dominantCoreChanges: 2, overloadedCoreSamples: 4,
      sampleCount: 8, observedCount: 7, confidence: 0.875,
      recommendations: ['review-core-contention']
    });
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(createCpuUtilizationCoreSkewLibrary())).toBe(true);
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuUtilizationCoreSkewReports([report()])).toMatchObject({
      state: 'balanced', recommendations: ['no-change']
    });
    expect(mergeCpuUtilizationCoreSkewReports([])).toMatchObject({
      reportCount: 0, state: 'insufficient-data', averageSkewPercent: null,
      maximumSkewPercent: null, dominantCoreChanges: 0, overloadedCoreSamples: 0,
      sampleCount: 0, observedCount: 0, confidence: 0,
      recommendations: ['collect-more-core-samples']
    });
    expect(mergeCpuUtilizationCoreSkewReports([report({ state: 'migration-watch',
      dominantCoreChanges: 1 })])).toMatchObject({ state: 'migration-watch',
      recommendations: ['observe-dominant-core-migration'] });
    expect(mergeCpuUtilizationCoreSkewReports([report({ state: 'no-observation',
      sampleCount: 0, observedCount: 0, averageSkewPercent: null, maximumSkewPercent: null })]))
      .toMatchObject({ state: 'no-observation', confidence: 0,
        recommendations: ['request-core-utilization-observation'] });
    expect(mergeCpuUtilizationCoreSkewReports([report({ state: 'insufficient-data',
      sampleCount: 1, observedCount: 1 })])).toMatchObject({ state: 'insufficient-data', confidence: 1 });
  });

  test('builds state-specific plans and immutable envelopes', () => {
    expect(buildCpuUtilizationCoreSkewPlan(report({ state: 'high-skew' }), 'interactive'))
      .toMatchObject({ environment: 'interactive', mode: 'contention-observation', intervalMs: 500, confidence: 1 });
    expect(buildCpuUtilizationCoreSkewPlan(report({ state: 'migration-watch' }), 'headless'))
      .toMatchObject({ mode: 'migration-observation', intervalMs: 750 });
    expect(buildCpuUtilizationCoreSkewPlan(report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, averageSkewPercent: null, maximumSkewPercent: null }), 'headless'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000, confidence: 0 });
    expect(buildCpuUtilizationCoreSkewPlan(report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 1 }), 'interactive')).toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuUtilizationCoreSkewPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuUtilizationCoreSkewPlan(report(), 'unclassified')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', intervalMs: 5000
    });
    const envelope = buildCpuUtilizationCoreSkewEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
  });

  test('rejects malformed reports, collections, triggers, clocks, and limits', () => {
    expect(() => mergeCpuUtilizationCoreSkewReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuUtilizationCoreSkewReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuUtilizationCoreSkewReports([null])).toThrow('report must be an object');
    expect(() => mergeCpuUtilizationCoreSkewReports([report({ turbo: 'other' })]))
      .toThrow('requires a core-skew turbo report');
    expect(() => mergeCpuUtilizationCoreSkewReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuUtilizationCoreSkewReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuUtilizationCoreSkewReports([report({ observedCount: 5 })]))
      .toThrow('observedCount must fit');
    expect(() => mergeCpuUtilizationCoreSkewReports([report({ averageSkewPercent: 101 })]))
      .toThrow('average skew must be null or between');
    expect(() => mergeCpuUtilizationCoreSkewReports([report({ maximumSkewPercent: -1 })]))
      .toThrow('maximum skew must be null or between');
    expect(() => mergeCpuUtilizationCoreSkewReports([report({ dominantCoreChanges: -1 })]))
      .toThrow('dominant changes must be non-negative');
    expect(() => mergeCpuUtilizationCoreSkewReports([report({ overloadedCoreSamples: -1 })]))
      .toThrow('overloaded samples must be non-negative');
    expect(() => buildCpuUtilizationCoreSkewEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuUtilizationCoreSkewEnvelope(report(), { trigger: '', now: () => 0 }))
      .toThrow('trigger is required');
    expect(() => buildCpuUtilizationCoreSkewEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
