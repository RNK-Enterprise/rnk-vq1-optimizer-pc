import {
  GPU_MULTI_GPU_SKEW_LIBRARY_ID,
  GPU_MULTI_GPU_SKEW_LIBRARY_VERSION,
  buildGpuMultiGpuSkewEnvelope,
  buildGpuMultiGpuSkewPlan,
  createGpuMultiGpuSkewLibrary,
  mergeGpuMultiGpuSkewReports
} from '../pc/engines/gpu-utilization/turbos/multi-gpu-skew/library.js';

function report(overrides = {}) {
  return {
    turbo: 'gpu-utilization.multi-gpu-skew',
    state: 'balanced-gpu-layout',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    noGpuCount: 0,
    skewCount: 0,
    balancedCount: 4,
    confidence: 1,
    ...overrides
  };
}

describe('GPU multi-gpu-skew library', () => {
  test('publishes identity and merges adapter-balance evidence', () => {
    const merged = mergeGpuMultiGpuSkewReports([
      report({ sampleCount: 2, observedCount: 2, skewCount: 1, balancedCount: 1 }),
      report({ state: 'sustained-skew', sampleCount: 6, observedCount: 5,
        unknownCount: 1, skewCount: 3, balancedCount: 2, confidence: 0.8333 })
    ]);
    expect(GPU_MULTI_GPU_SKEW_LIBRARY_ID).toBe('gpu-utilization.multi-gpu-skew.library');
    expect(GPU_MULTI_GPU_SKEW_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'sustained-skew',
      sampleCount: 8, observedCount: 7, unknownCount: 1, skewCount: 4,
      balancedCount: 3, confidence: 0.875,
      recommendations: ['review-gpu-workload-distribution', 'hold-unapproved-gpu-policy'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeGpuMultiGpuSkewReports([])).toMatchObject({ state: 'insufficient-data',
      reportCount: 0, confidence: 0, recommendations: ['collect-more-gpu-skew-samples'] });
    expect(mergeGpuMultiGpuSkewReports([report({ state: 'no-gpu', sampleCount: 0,
      observedCount: 0, unknownCount: 0, noGpuCount: 0, balancedCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-gpu', confidence: 0, recommendations: ['no-change', 'keep-gpu-controls-disabled'] });
    expect(mergeGpuMultiGpuSkewReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, balancedCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', recommendations: ['request-gpu-skew-observation'] });
    expect(mergeGpuMultiGpuSkewReports([report({ state: 'invalid-skew-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-skew-evidence', recommendations: ['review-gpu-utilization-sensor-range'] });
    expect(mergeGpuMultiGpuSkewReports([report({ state: 'skew-observed', skewCount: 1 })]))
      .toMatchObject({ state: 'skew-observed', recommendations: ['observe-next-gpu-layout-sample'] });
    expect(mergeGpuMultiGpuSkewReports([report({ state: 'balanced-gpu-layout' })]))
      .toMatchObject({ state: 'balanced-gpu-layout', recommendations: ['no-change'] });
    expect(mergeGpuMultiGpuSkewReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, balancedCount: 0, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuMultiGpuSkewReports([
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0, unknownCount: 0, balancedCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, balancedCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies precedence and builds every state plan', () => {
    expect(mergeGpuMultiGpuSkewReports([
      report({ state: 'sustained-skew', skewCount: 1 }),
      report({ state: 'invalid-skew-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-skew-evidence' });
    const states = [
      ['invalid-skew-evidence', 'sensor-review', 500],
      ['sustained-skew', 'workload-distribution-review', 750],
      ['skew-observed', 'skew-observation', 1000],
      ['no-gpu', 'no-gpu-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['balanced-gpu-layout', 'balanced-layout-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildGpuMultiGpuSkewPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildGpuMultiGpuSkewPlan(report({ state: 'balanced-gpu-layout' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildGpuMultiGpuSkewPlan(report({ state: 'balanced-gpu-layout', sampleCount: 0,
      observedCount: 0, unknownCount: 0, balancedCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildGpuMultiGpuSkewEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: GPU_MULTI_GPU_SKEW_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuMultiGpuSkewLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(GPU_MULTI_GPU_SKEW_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, balancedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeGpuMultiGpuSkewReports(null)).toThrow('reports must be an array');
    expect(() => mergeGpuMultiGpuSkewReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeGpuMultiGpuSkewReports([null])).toThrow('report must be an object');
    expect(() => mergeGpuMultiGpuSkewReports([[]])).toThrow('report must be an object');
    expect(() => mergeGpuMultiGpuSkewReports([report({ turbo: 'other' })]))
      .toThrow('requires a multi-gpu-skew turbo report');
    expect(() => mergeGpuMultiGpuSkewReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeGpuMultiGpuSkewReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'noGpuCount', 'skewCount', 'balancedCount']) {
      expect(() => mergeGpuMultiGpuSkewReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeGpuMultiGpuSkewReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeGpuMultiGpuSkewReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildGpuMultiGpuSkewEnvelope(report())).toThrow('trigger is required');
    expect(() => buildGpuMultiGpuSkewEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildGpuMultiGpuSkewEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildGpuMultiGpuSkewEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
