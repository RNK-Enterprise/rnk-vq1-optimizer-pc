import {
  CPU_AFFINITY_DRIFT_LIBRARY_ID,
  CPU_AFFINITY_DRIFT_LIBRARY_VERSION,
  buildCpuAffinityDriftEnvelope,
  buildCpuAffinityDriftPlan,
  createCpuAffinityDriftLibrary,
  mergeCpuAffinityDriftReports
} from '../pc/engines/cpu-affinity/turbos/mask-drift/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-affinity.mask-drift',
    state: 'stable-layout',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    comparisonCount: 3,
    changeCount: 1,
    peakDrift: 0.5,
    meanDrift: 0.25,
    ...overrides
  };
}

describe('CPU-affinity mask-drift library', () => {
  test('publishes identity and merges weighted drift evidence', () => {
    const merged = mergeCpuAffinityDriftReports([
      report({ state: 'drift-watch', sampleCount: 2, observedCount: 2,
        comparisonCount: 1, changeCount: 1, peakDrift: 0.5, meanDrift: 0.1 }),
      report({ state: 'high-drift', sampleCount: 6, observedCount: 5,
        unknownCount: 1, comparisonCount: 5, changeCount: 4, peakDrift: 0.8, meanDrift: 0.4 })
    ]);
    expect(CPU_AFFINITY_DRIFT_LIBRARY_ID).toBe('cpu-affinity.mask-drift.library');
    expect(CPU_AFFINITY_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'high-drift',
      observedCount: 7, unknownCount: 1, comparisonCount: 6, changeCount: 5,
      peakDrift: 0.8, meanDrift: 0.325, sampleCount: 8, confidence: 0.875,
      recommendations: ['review-affinity-list-change'] });
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuAffinityDriftReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0, recommendations: ['collect-more-affinity-samples']
    });
    expect(mergeCpuAffinityDriftReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, changeCount: 0,
      peakDrift: null, meanDrift: null })])).toMatchObject({ state: 'no-observation', confidence: 0,
      recommendations: ['request-affinity-drift-observation'] });
    expect(mergeCpuAffinityDriftReports([report({ state: 'frequent-drift' })]))
      .toMatchObject({ state: 'frequent-drift', recommendations: ['observe-affinity-change-duration'] });
    expect(mergeCpuAffinityDriftReports([report({ state: 'drift-watch' })]))
      .toMatchObject({ state: 'drift-watch', recommendations: ['observe-next-affinity-sample'] });
    expect(mergeCpuAffinityDriftReports([report({ state: 'stable-layout' })]))
      .toMatchObject({ state: 'stable-layout', recommendations: ['no-change'] });
    expect(mergeCpuAffinityDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, changeCount: 0,
      peakDrift: null, meanDrift: null })])).toMatchObject({ state: 'insufficient-data' });
  });

  test('builds state-specific plans, envelopes, and a frozen factory', () => {
    expect(buildCpuAffinityDriftPlan(report({ state: 'frequent-drift' }), 'interactive'))
      .toMatchObject({ mode: 'change-observation', intervalMs: 500 });
    expect(buildCpuAffinityDriftPlan(report({ state: 'high-drift' }), 'headless'))
      .toMatchObject({ mode: 'drift-review', intervalMs: 750 });
    expect(buildCpuAffinityDriftPlan(report({ state: 'drift-watch' }), 'interactive'))
      .toMatchObject({ mode: 'trend-observation', intervalMs: 1000 });
    expect(buildCpuAffinityDriftPlan(report({ state: 'no-observation' }), 'interactive'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000 });
    expect(buildCpuAffinityDriftPlan(report({ state: 'insufficient-data' }), 'interactive'))
      .toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuAffinityDriftPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuAffinityDriftPlan(report({ observedCount: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
    const envelope = buildCpuAffinityDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: CPU_AFFINITY_DRIFT_LIBRARY_ID,
      trigger: 'health.interval', generatedAt: new Date(0).toISOString() });
    const factory = createCpuAffinityDriftLibrary();
    expect(Object.isFrozen(factory)).toBe(true);
    expect(factory.id).toBe(CPU_AFFINITY_DRIFT_LIBRARY_ID);
    expect(factory.version).toBe(1);
    expect(factory.merge([])).toMatchObject({ state: 'insufficient-data' });
  });

  test('rejects malformed reports, limits, fields, triggers, and clocks', () => {
    expect(() => mergeCpuAffinityDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuAffinityDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuAffinityDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a mask-drift turbo report');
    expect(() => mergeCpuAffinityDriftReports([report({ state: 'bad' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuAffinityDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuAffinityDriftReports([report({ observedCount: 5 })]))
      .toThrow('observed count must fit');
    expect(() => mergeCpuAffinityDriftReports([report({ unknownCount: 5 })]))
      .toThrow('unknown count must fit');
    expect(() => mergeCpuAffinityDriftReports([report({ comparisonCount: 5 })]))
      .toThrow('comparison count must fit');
    expect(() => mergeCpuAffinityDriftReports([report({ changeCount: 5 })]))
      .toThrow('change count must fit');
    expect(() => mergeCpuAffinityDriftReports([report({ peakDrift: 2 })]))
      .toThrow('peak drift must be null or between');
    expect(() => mergeCpuAffinityDriftReports([report({ meanDrift: -1 })]))
      .toThrow('mean drift must be null or between');
    expect(() => buildCpuAffinityDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuAffinityDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => mergeCpuAffinityDriftReports([null])).toThrow('report must be an object');
  });
});
