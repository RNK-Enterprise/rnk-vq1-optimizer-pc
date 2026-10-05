import {
  CPU_AFFINITY_MASK_LIBRARY_ID,
  CPU_AFFINITY_MASK_LIBRARY_VERSION,
  buildCpuAffinityMaskEnvelope,
  buildCpuAffinityMaskPlan,
  createCpuAffinityMaskLibrary,
  mergeCpuAffinityMaskReports
} from '../pc/engines/cpu-affinity/turbos/mask-skew/library.js';

function report(overrides = {}) {
  return {
    turbo: 'cpu-affinity.mask-skew',
    state: 'stable-layout',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    overlapSampleCount: 1,
    overIsolatedSampleCount: 1,
    underCoveredSampleCount: 1,
    peakAffinityCoverage: 0.5,
    peakIsolationCoverage: 0.5,
    peakOverlapCount: 1,
    ...overrides
  };
}

describe('CPU-affinity mask-skew library', () => {
  test('publishes identity and merges weighted topology evidence', () => {
    const merged = mergeCpuAffinityMaskReports([
      report({ state: 'under-covered', sampleCount: 2, observedCount: 2,
        overlapSampleCount: 0, overIsolatedSampleCount: 0, underCoveredSampleCount: 2,
        peakAffinityCoverage: 0.25, peakIsolationCoverage: 0.125, peakOverlapCount: 0 }),
      report({ state: 'overlap-risk', sampleCount: 6, observedCount: 5,
        unknownCount: 1, overlapSampleCount: 3, overIsolatedSampleCount: 2,
        underCoveredSampleCount: 0, peakAffinityCoverage: 0.8,
        peakIsolationCoverage: 0.9, peakOverlapCount: 2 })
    ]);
    expect(CPU_AFFINITY_MASK_LIBRARY_ID).toBe('cpu-affinity.mask-skew.library');
    expect(CPU_AFFINITY_MASK_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'overlap-risk',
      observedCount: 7, unknownCount: 1, overlapSampleCount: 3,
      overIsolatedSampleCount: 2, underCoveredSampleCount: 2,
      peakAffinityCoverage: 0.8, peakIsolationCoverage: 0.9, peakOverlapCount: 2,
      sampleCount: 8, confidence: 0.875,
      recommendations: ['review-affinity-isolation-overlap'] });
  });

  test('preserves every aggregate state and zero-sample confidence', () => {
    expect(mergeCpuAffinityMaskReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0, recommendations: ['collect-more-affinity-samples']
    });
    expect(mergeCpuAffinityMaskReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, overlapSampleCount: 0, overIsolatedSampleCount: 0,
      underCoveredSampleCount: 0, peakAffinityCoverage: null, peakIsolationCoverage: null,
      peakOverlapCount: null })])).toMatchObject({ state: 'no-observation', confidence: 0,
      recommendations: ['request-affinity-topology-observation'] });
    expect(mergeCpuAffinityMaskReports([report({ state: 'over-isolated' })]))
      .toMatchObject({ state: 'over-isolated', recommendations: ['review-isolated-cpu-coverage'] });
    expect(mergeCpuAffinityMaskReports([report({ state: 'under-covered' })]))
      .toMatchObject({ state: 'under-covered', recommendations: ['review-affinity-cpu-coverage'] });
    expect(mergeCpuAffinityMaskReports([report({ state: 'stable-layout' })]))
      .toMatchObject({ state: 'stable-layout', recommendations: ['no-change'] });
    expect(mergeCpuAffinityMaskReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, overlapSampleCount: 0, overIsolatedSampleCount: 0,
      underCoveredSampleCount: 0, peakAffinityCoverage: null, peakIsolationCoverage: null,
      peakOverlapCount: null })])).toMatchObject({ state: 'insufficient-data' });
  });

  test('builds state-specific plans, envelopes, and a frozen factory', () => {
    expect(buildCpuAffinityMaskPlan(report({ state: 'overlap-risk' }), 'interactive'))
      .toMatchObject({ mode: 'overlap-review', intervalMs: 500 });
    expect(buildCpuAffinityMaskPlan(report({ state: 'over-isolated' }), 'headless'))
      .toMatchObject({ mode: 'isolation-review', intervalMs: 750 });
    expect(buildCpuAffinityMaskPlan(report({ state: 'under-covered' }), 'interactive'))
      .toMatchObject({ mode: 'affinity-review', intervalMs: 750 });
    expect(buildCpuAffinityMaskPlan(report({ state: 'no-observation' }), 'interactive'))
      .toMatchObject({ mode: 'observation-bootstrap', intervalMs: 2000 });
    expect(buildCpuAffinityMaskPlan(report({ state: 'insufficient-data' }), 'interactive'))
      .toMatchObject({ mode: 'sample-bootstrap', intervalMs: 1500 });
    expect(buildCpuAffinityMaskPlan(report(), 'headless'))
      .toMatchObject({ mode: 'relaxed-observation', intervalMs: 10000 });
    expect(buildCpuAffinityMaskPlan(report({ observedCount: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
    const envelope = buildCpuAffinityMaskEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: CPU_AFFINITY_MASK_LIBRARY_ID,
      trigger: 'health.interval', generatedAt: new Date(0).toISOString() });
    const factory = createCpuAffinityMaskLibrary();
    expect(Object.isFrozen(factory)).toBe(true);
    expect(factory.id).toBe(CPU_AFFINITY_MASK_LIBRARY_ID);
    expect(factory.version).toBe(1);
    expect(factory.merge([])).toMatchObject({ state: 'insufficient-data' });
  });

  test('rejects malformed reports, limits, fields, triggers, and clocks', () => {
    expect(() => mergeCpuAffinityMaskReports(null)).toThrow('reports must be an array');
    expect(() => mergeCpuAffinityMaskReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCpuAffinityMaskReports([report({ turbo: 'other' })]))
      .toThrow('requires a mask-skew turbo report');
    expect(() => mergeCpuAffinityMaskReports([report({ state: 'bad' })]))
      .toThrow('invalid state');
    expect(() => mergeCpuAffinityMaskReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeCpuAffinityMaskReports([report({ observedCount: 5 })]))
      .toThrow('observed count must fit');
    expect(() => mergeCpuAffinityMaskReports([report({ unknownCount: 5 })]))
      .toThrow('unknown count must fit');
    expect(() => mergeCpuAffinityMaskReports([report({ overlapSampleCount: 5 })]))
      .toThrow('overlap count must fit');
    expect(() => mergeCpuAffinityMaskReports([report({ overIsolatedSampleCount: 5 })]))
      .toThrow('over-isolated count must fit');
    expect(() => mergeCpuAffinityMaskReports([report({ underCoveredSampleCount: 5 })]))
      .toThrow('under-covered count must fit');
    expect(() => mergeCpuAffinityMaskReports([report({ peakAffinityCoverage: 2 })]))
      .toThrow('affinity coverage must be null or between');
    expect(() => mergeCpuAffinityMaskReports([report({ peakIsolationCoverage: -1 })]))
      .toThrow('isolation coverage must be null or between');
    expect(() => mergeCpuAffinityMaskReports([report({ peakOverlapCount: -1 })]))
      .toThrow('peak overlap must be null or non-negative');
    expect(() => buildCpuAffinityMaskEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCpuAffinityMaskEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => mergeCpuAffinityMaskReports([null])).toThrow('report must be an object');
  });
});
