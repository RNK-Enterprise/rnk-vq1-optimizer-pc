import {
  GPU_CAPACITY_SKEW_LIBRARY_ID,
  GPU_CAPACITY_SKEW_LIBRARY_VERSION,
  buildGpuCapacitySkewEnvelope,
  buildGpuCapacitySkewPlan,
  createGpuCapacitySkewLibrary,
  mergeGpuCapacitySkewReports
} from '../pc/engines/gpu-memory/turbos/capacity-skew/library.js';

function report(overrides = {}) {
  return {
    turbo: 'gpu-memory.capacity-skew',
    state: 'balanced-capacity',
    sampleCount: 4,
    minimumSamples: 2,
    persistenceThreshold: 2,
    skewThreshold: 25,
    observedCount: 4,
    invalidCount: 0,
    incompleteCount: 0,
    noGpuCount: 0,
    skewCount: 0,
    balancedCount: 4,
    maximumSkew: 0,
    confidence: 1,
    ...overrides
  };
}

describe('gpu-memory capacity-skew library', () => {
  test('publishes identity and merges capacity evidence', () => {
    const merged = mergeGpuCapacitySkewReports([
      report({ sampleCount: 2, observedCount: 2, skewCount: 1, balancedCount: 1,
        maximumSkew: 20 }),
      report({ state: 'sustained-capacity-skew', sampleCount: 6, observedCount: 5,
        skewCount: 3, balancedCount: 2, maximumSkew: 50, confidence: 0.8333 })
    ]);

    expect(GPU_CAPACITY_SKEW_LIBRARY_ID).toBe('gpu-memory.capacity-skew.library');
    expect(GPU_CAPACITY_SKEW_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'sustained-capacity-skew',
      sampleCount: 8,
      observedCount: 7,
      skewCount: 4,
      balancedCount: 3,
      maximumSkew: 50,
      confidence: 0.875,
      recommendations: ['review-multi-gpu-capacity-layout', 'hold-unapproved-memory-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeGpuCapacitySkewReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0, maximumSkew: 0,
      recommendations: ['collect-more-vram-capacity-samples']
    });
    expect(mergeGpuCapacitySkewReports([report({ state: 'no-gpu', sampleCount: 0,
      observedCount: 0, balancedCount: 0, confidence: 0 })])).toMatchObject({
      state: 'no-gpu', confidence: 0, recommendations: ['no-change', 'keep-gpu-memory-controls-disabled']
    });
    expect(mergeGpuCapacitySkewReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, balancedCount: 0, confidence: 0 })])).toMatchObject({
      state: 'no-observation', recommendations: ['request-vram-capacity-observation']
    });
    expect(mergeGpuCapacitySkewReports([report({ state: 'invalid-vram-evidence', invalidCount: 1 })]))
      .toMatchObject({ state: 'invalid-vram-evidence', recommendations: ['review-vram-capacity-range'] });
    expect(mergeGpuCapacitySkewReports([report({ state: 'incomplete-vram-evidence', incompleteCount: 1 })]))
      .toMatchObject({ state: 'incomplete-vram-evidence', recommendations: ['request-complete-vram-capacity'] });
    expect(mergeGpuCapacitySkewReports([report({ state: 'capacity-skew-observed', skewCount: 1 })]))
      .toMatchObject({ state: 'capacity-skew-observed', recommendations: ['observe-next-vram-capacity-sample'] });
    expect(mergeGpuCapacitySkewReports([report()])).toMatchObject({
      state: 'balanced-capacity', recommendations: ['no-change']
    });
    expect(mergeGpuCapacitySkewReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, balancedCount: 0, confidence: 0 })])).toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuCapacitySkewReports([
      report({ state: 'no-gpu', sampleCount: 0, observedCount: 0, balancedCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, balancedCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeGpuCapacitySkewReports([
      report({ state: 'sustained-capacity-skew', skewCount: 1 }),
      report({ state: 'invalid-vram-evidence', invalidCount: 1 })
    ])).toMatchObject({ state: 'invalid-vram-evidence' });
    const states = [
      ['sustained-capacity-skew', 'capacity-layout-review', 750],
      ['capacity-skew-observed', 'capacity-skew-observation', 1000],
      ['balanced-capacity', 'balanced-capacity-observation', 5000],
      ['invalid-vram-evidence', 'capacity-review', 500],
      ['incomplete-vram-evidence', 'evidence-bootstrap', 1500],
      ['no-gpu', 'no-gpu-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildGpuCapacitySkewPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildGpuCapacitySkewPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildGpuCapacitySkewPlan(report({ sampleCount: 0, observedCount: 0,
      balancedCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildGpuCapacitySkewEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: GPU_CAPACITY_SKEW_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuCapacitySkewLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(GPU_CAPACITY_SKEW_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      balancedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeGpuCapacitySkewReports(null)).toThrow('reports must be an array');
    expect(() => mergeGpuCapacitySkewReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeGpuCapacitySkewReports([null])).toThrow('report must be an object');
    expect(() => mergeGpuCapacitySkewReports([[]])).toThrow('report must be an object');
    expect(() => mergeGpuCapacitySkewReports([report({ turbo: 'other' })]))
      .toThrow('requires a capacity-skew turbo report');
    expect(() => mergeGpuCapacitySkewReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeGpuCapacitySkewReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'invalidCount', 'incompleteCount', 'noGpuCount',
      'skewCount', 'balancedCount']) {
      expect(() => mergeGpuCapacitySkewReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeGpuCapacitySkewReports([report({ maximumSkew: -1 })]))
      .toThrow('maximumSkew must be between 0 and 100');
    expect(() => mergeGpuCapacitySkewReports([report({ skewThreshold: 101 })]))
      .toThrow('skewThreshold must be between 0 and 100');
    expect(() => mergeGpuCapacitySkewReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeGpuCapacitySkewReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildGpuCapacitySkewEnvelope(report())).toThrow('trigger is required');
    expect(() => buildGpuCapacitySkewEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildGpuCapacitySkewEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildGpuCapacitySkewEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
