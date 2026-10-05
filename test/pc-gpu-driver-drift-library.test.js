import {
  GPU_DRIVER_DRIFT_LIBRARY_ID,
  GPU_DRIVER_DRIFT_LIBRARY_VERSION,
  buildGpuDriverDriftEnvelope,
  buildGpuDriverDriftPlan,
  createGpuDriverDriftLibrary,
  mergeGpuDriverDriftReports
} from '../pc/engines/gpu-policy/turbos/driver-drift/library.js';

function report(overrides = {}) {
  return {
    turbo: 'gpu-policy.driver-drift',
    state: 'documented-driver-stable',
    sampleCount: 4,
    observedCount: 4,
    unknownCount: 0,
    invalidCount: 0,
    noGpuCount: 0,
    incompleteCount: 0,
    changeCount: 0,
    reviewCount: 0,
    comparisonCount: 3,
    changeThreshold: 1,
    confidence: 1,
    ...overrides
  };
}

describe('gpu-policy driver-drift library', () => {
  test('publishes identity and merges driver evidence', () => {
    const merged = mergeGpuDriverDriftReports([
      report({ sampleCount: 2, observedCount: 2, comparisonCount: 1, changeCount: 1 }),
      report({ state: 'driver-drift', sampleCount: 6, observedCount: 5,
        unknownCount: 1, incompleteCount: 0, changeCount: 2, comparisonCount: 5, confidence: 0.8333 })
    ]);

    expect(GPU_DRIVER_DRIFT_LIBRARY_ID).toBe('gpu-policy.driver-drift.library');
    expect(GPU_DRIVER_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'driver-drift',
      sampleCount: 8,
      observedCount: 7,
      unknownCount: 1,
      changeCount: 3,
      comparisonCount: 6,
      confidence: 0.875,
      recommendations: ['review-driver-change', 'hold-driver-automation']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeGpuDriverDriftReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      recommendations: ['collect-more-driver-samples']
    });
    expect(mergeGpuDriverDriftReports([report({ state: 'no-gpu', sampleCount: 0,
      observedCount: 0, noGpuCount: 0, comparisonCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-gpu', confidence: 0,
        recommendations: ['no-change', 'keep-gpu-controls-disabled'] });
    expect(mergeGpuDriverDriftReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', recommendations: ['request-driver-observation'] });
    expect(mergeGpuDriverDriftReports([report({ state: 'incomplete-driver-evidence', incompleteCount: 1 })]))
      .toMatchObject({ state: 'incomplete-driver-evidence', recommendations: ['request-complete-driver-evidence'] });
    expect(mergeGpuDriverDriftReports([report({ state: 'vendor-specific-driver', reviewCount: 1 })]))
      .toMatchObject({ state: 'vendor-specific-driver', recommendations: ['review-documented-driver-controls-without-change'] });
    expect(mergeGpuDriverDriftReports([report()])).toMatchObject({
      state: 'documented-driver-stable', recommendations: ['no-change']
    });
    expect(mergeGpuDriverDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, confidence: 0 })]))
      .toMatchObject({ state: 'insufficient-data' });
    expect(mergeGpuDriverDriftReports([
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0,
        unknownCount: 0, comparisonCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0,
        unknownCount: 1, comparisonCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'insufficient-data' });
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeGpuDriverDriftReports([
      report({ state: 'driver-drift', changeCount: 1 }),
      report({ state: 'incomplete-driver-evidence', incompleteCount: 1 })
    ])).toMatchObject({ state: 'incomplete-driver-evidence' });
    const states = [
      ['driver-drift', 'driver-change-review', 750],
      ['vendor-specific-driver', 'driver-documentation-review', 1000],
      ['incomplete-driver-evidence', 'evidence-bootstrap', 1500],
      ['no-gpu', 'no-gpu-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['documented-driver-stable', 'stable-driver-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      expect(buildGpuDriverDriftPlan(report({ state, observedCount: 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: 0.5 });
    }
    expect(buildGpuDriverDriftPlan(report({ state: 'documented-driver-stable' }), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildGpuDriverDriftPlan(report({ state: 'documented-driver-stable', sampleCount: 0,
      observedCount: 0, unknownCount: 0, comparisonCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildGpuDriverDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: GPU_DRIVER_DRIFT_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuDriverDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(GPU_DRIVER_DRIFT_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeGpuDriverDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeGpuDriverDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeGpuDriverDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeGpuDriverDriftReports([[]])).toThrow('report must be an object');
    expect(() => mergeGpuDriverDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a driver-drift turbo report');
    expect(() => mergeGpuDriverDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeGpuDriverDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'unknownCount', 'invalidCount', 'noGpuCount',
      'incompleteCount', 'changeCount', 'reviewCount', 'comparisonCount']) {
      expect(() => mergeGpuDriverDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeGpuDriverDriftReports([report({ changeThreshold: 0 })]))
      .toThrow('changeThreshold must be from 1 to 64');
    expect(() => mergeGpuDriverDriftReports([report({ changeThreshold: 65 })]))
      .toThrow('changeThreshold must be from 1 to 64');
    expect(() => mergeGpuDriverDriftReports([report({ confidence: -0.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => mergeGpuDriverDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildGpuDriverDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildGpuDriverDriftEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildGpuDriverDriftEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildGpuDriverDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
