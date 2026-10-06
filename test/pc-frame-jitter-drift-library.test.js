import {
  FRAME_JITTER_DRIFT_LIBRARY_ID,
  FRAME_JITTER_DRIFT_LIBRARY_VERSION,
  buildFrameJitterDriftEnvelope,
  buildFrameJitterDriftPlan,
  createFrameJitterDriftLibrary,
  mergeFrameJitterDriftReports
} from '../pc/engines/frame-pacing/turbos/jitter-drift/library.js';

function report(overrides = {}) {
  return {
    turbo: 'frame-pacing.jitter-drift',
    state: 'stable-jitter',
    sampleCount: 4,
    minimumSamples: 2,
    observedCount: 4,
    incompleteCount: 0,
    noDisplayCount: 0,
    noObservationCount: 0,
    deltaCount: 0,
    comparisonCount: 3,
    maximumDelta: 0,
    deltaThreshold: 2,
    changeThreshold: 1,
    confidence: 1,
    ...overrides
  };
}

describe('frame-pacing jitter-drift library', () => {
  test('publishes identity and merges jitter evidence', () => {
    const merged = mergeFrameJitterDriftReports([
      report({ sampleCount: 2, observedCount: 2, deltaCount: 1, comparisonCount: 1,
        maximumDelta: 3 }),
      report({ state: 'sustained-jitter-drift', sampleCount: 6, observedCount: 5,
        deltaCount: 3, comparisonCount: 5, maximumDelta: 8, confidence: 0.8333 })
    ]);

    expect(FRAME_JITTER_DRIFT_LIBRARY_ID).toBe('frame-pacing.jitter-drift.library');
    expect(FRAME_JITTER_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'sustained-jitter-drift',
      sampleCount: 8,
      observedCount: 7,
      deltaCount: 4,
      comparisonCount: 6,
      maximumDelta: 8,
      confidence: 0.875,
      recommendations: ['review-frame-jitter', 'hold-unapproved-display-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeFrameJitterDriftReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      maximumDelta: 0, recommendations: ['collect-more-jitter-samples']
    });
    expect(mergeFrameJitterDriftReports([report({ state: 'no-display', sampleCount: 0,
      observedCount: 0, comparisonCount: 0, confidence: 0 })])).toMatchObject({
      state: 'no-display', confidence: 0, recommendations: ['keep-display-controls-disabled']
    });
    expect(mergeFrameJitterDriftReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, comparisonCount: 0, confidence: 0 })])).toMatchObject({
      state: 'no-observation', recommendations: ['request-frame-pacing-observation']
    });
    expect(mergeFrameJitterDriftReports([report({ state: 'incomplete-jitter-evidence',
      incompleteCount: 1 })])).toMatchObject({
      state: 'incomplete-jitter-evidence', recommendations: ['request-complete-jitter-evidence']
    });
    expect(mergeFrameJitterDriftReports([report({ state: 'jitter-drift-observed', deltaCount: 1 })])
    ).toMatchObject({ state: 'jitter-drift-observed', recommendations: ['observe-next-jitter-sample'] });
    expect(mergeFrameJitterDriftReports([report()])).toMatchObject({
      state: 'stable-jitter', recommendations: ['no-change']
    });
    expect(mergeFrameJitterDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeFrameJitterDriftReports([
      report({ state: 'no-display', sampleCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }),
      report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, comparisonCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'no-display' });
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeFrameJitterDriftReports([
      report({ state: 'sustained-jitter-drift', deltaCount: 1 }),
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0,
        comparisonCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'no-observation' });
    const states = [
      ['sustained-jitter-drift', 'jitter-review', 750],
      ['jitter-drift-observed', 'jitter-observation', 1000],
      ['stable-jitter', 'stable-jitter-observation', 5000],
      ['no-display', 'no-display-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['incomplete-jitter-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const sampleCount = state === 'no-display' || state === 'no-observation' ? 0 : 4;
      const confidence = sampleCount === 0 ? 0 : 1;
      expect(buildFrameJitterDriftPlan(report({ state, sampleCount,
        observedCount: sampleCount, comparisonCount: Math.max(0, sampleCount - 1) }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildFrameJitterDriftPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildFrameJitterDriftPlan(report({ sampleCount: 0, observedCount: 0,
      comparisonCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildFrameJitterDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: FRAME_JITTER_DRIFT_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createFrameJitterDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(FRAME_JITTER_DRIFT_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      comparisonCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeFrameJitterDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeFrameJitterDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeFrameJitterDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeFrameJitterDriftReports([[]])).toThrow('report must be an object');
    expect(() => mergeFrameJitterDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a jitter-drift turbo report');
    expect(() => mergeFrameJitterDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeFrameJitterDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    for (const field of ['observedCount', 'incompleteCount', 'noDisplayCount',
      'noObservationCount', 'deltaCount', 'comparisonCount']) {
      expect(() => mergeFrameJitterDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeFrameJitterDriftReports([report({ maximumDelta: -1 })]))
      .toThrow('thresholds and maximumDelta must be non-negative');
    expect(() => mergeFrameJitterDriftReports([report({ deltaThreshold: -1 })]))
      .toThrow('thresholds and maximumDelta must be non-negative');
    expect(() => mergeFrameJitterDriftReports([report({ changeThreshold: 0 })]))
      .toThrow('changeThreshold must be from 1 to 64');
    expect(() => mergeFrameJitterDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildFrameJitterDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildFrameJitterDriftEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildFrameJitterDriftEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildFrameJitterDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
