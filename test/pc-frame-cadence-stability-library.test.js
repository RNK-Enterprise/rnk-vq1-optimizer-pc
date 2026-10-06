import {
  FRAME_CADENCE_STABILITY_LIBRARY_ID,
  FRAME_CADENCE_STABILITY_LIBRARY_VERSION,
  buildFrameCadenceStabilityEnvelope,
  buildFrameCadenceStabilityPlan,
  createFrameCadenceStabilityLibrary,
  mergeFrameCadenceStabilityReports
} from '../pc/engines/frame-pacing/turbos/cadence-stability/library.js';

function report(overrides = {}) {
  return {
    turbo: 'frame-pacing.cadence-stability',
    state: 'stable-cadence',
    sampleCount: 4,
    minimumSamples: 2,
    persistenceThreshold: 2,
    observedCount: 4,
    incompleteCount: 0,
    noDisplayCount: 0,
    noObservationCount: 0,
    driftCount: 0,
    comparisonCount: 3,
    maximumDelta: 0,
    deltaThreshold: 2,
    confidence: 1,
    ...overrides
  };
}

describe('frame-pacing cadence-stability library', () => {
  test('publishes identity and merges cadence evidence', () => {
    const merged = mergeFrameCadenceStabilityReports([
      report({ sampleCount: 2, observedCount: 2, driftCount: 1, comparisonCount: 1,
        maximumDelta: 3 }),
      report({ state: 'sustained-cadence-drift', sampleCount: 6, observedCount: 5,
        driftCount: 3, comparisonCount: 5, maximumDelta: 8, confidence: 0.8333 })
    ]);

    expect(FRAME_CADENCE_STABILITY_LIBRARY_ID).toBe('frame-pacing.cadence-stability.library');
    expect(FRAME_CADENCE_STABILITY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'sustained-cadence-drift',
      sampleCount: 8,
      observedCount: 7,
      driftCount: 4,
      comparisonCount: 6,
      maximumDelta: 8,
      confidence: 0.875,
      recommendations: ['review-frame-cadence', 'hold-unapproved-display-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeFrameCadenceStabilityReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      maximumDelta: 0, recommendations: ['collect-more-cadence-samples']
    });
    expect(mergeFrameCadenceStabilityReports([report({ state: 'no-display', sampleCount: 0,
      observedCount: 0, comparisonCount: 0, confidence: 0 })])).toMatchObject({
      state: 'no-display', confidence: 0, recommendations: ['keep-display-controls-disabled']
    });
    expect(mergeFrameCadenceStabilityReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, comparisonCount: 0, confidence: 0 })])).toMatchObject({
      state: 'no-observation', recommendations: ['request-cadence-observation']
    });
    expect(mergeFrameCadenceStabilityReports([report({ state: 'incomplete-cadence-evidence',
      incompleteCount: 1 })])).toMatchObject({
      state: 'incomplete-cadence-evidence', recommendations: ['request-complete-cadence-evidence']
    });
    expect(mergeFrameCadenceStabilityReports([report({ state: 'cadence-drift-observed', driftCount: 1 })])
    ).toMatchObject({ state: 'cadence-drift-observed', recommendations: ['observe-next-cadence-sample'] });
    expect(mergeFrameCadenceStabilityReports([report()])).toMatchObject({
      state: 'stable-cadence', recommendations: ['no-change']
    });
    expect(mergeFrameCadenceStabilityReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeFrameCadenceStabilityReports([
      report({ state: 'sustained-cadence-drift', driftCount: 2 }),
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0,
        comparisonCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'no-observation' });
    const states = [
      ['sustained-cadence-drift', 'cadence-review', 750],
      ['cadence-drift-observed', 'cadence-observation', 1000],
      ['stable-cadence', 'stable-cadence-observation', 5000],
      ['no-display', 'no-display-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['incomplete-cadence-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const unavailable = state === 'no-display' || state === 'no-observation';
      const sampleCount = unavailable ? 0 : 4;
      const confidence = unavailable ? 0 : 1;
      expect(buildFrameCadenceStabilityPlan(report({ state, sampleCount,
        observedCount: sampleCount, comparisonCount: Math.max(0, sampleCount - 1) }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildFrameCadenceStabilityPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildFrameCadenceStabilityPlan(report({ sampleCount: 0, observedCount: 0,
      comparisonCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildFrameCadenceStabilityEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: FRAME_CADENCE_STABILITY_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createFrameCadenceStabilityLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(FRAME_CADENCE_STABILITY_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      comparisonCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeFrameCadenceStabilityReports(null)).toThrow('reports must be an array');
    expect(() => mergeFrameCadenceStabilityReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeFrameCadenceStabilityReports([null])).toThrow('report must be an object');
    expect(() => mergeFrameCadenceStabilityReports([[]])).toThrow('report must be an object');
    expect(() => mergeFrameCadenceStabilityReports([report({ turbo: 'other' })]))
      .toThrow('requires a cadence-stability turbo report');
    expect(() => mergeFrameCadenceStabilityReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeFrameCadenceStabilityReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeFrameCadenceStabilityReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeFrameCadenceStabilityReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeFrameCadenceStabilityReports([report({ maximumDelta: -1 })]))
      .toThrow('thresholds and maximumDelta must be non-negative');
    expect(() => mergeFrameCadenceStabilityReports([report({ deltaThreshold: -1 })]))
      .toThrow('thresholds and maximumDelta must be non-negative');
    for (const field of ['observedCount', 'incompleteCount', 'noDisplayCount',
      'noObservationCount', 'driftCount', 'comparisonCount']) {
      expect(() => mergeFrameCadenceStabilityReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeFrameCadenceStabilityReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildFrameCadenceStabilityEnvelope(report())).toThrow('trigger is required');
    expect(() => buildFrameCadenceStabilityEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildFrameCadenceStabilityEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildFrameCadenceStabilityEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
