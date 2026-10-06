import {
  FRAME_TARGET_GAP_LIBRARY_ID,
  FRAME_TARGET_GAP_LIBRARY_VERSION,
  buildFrameTargetGapEnvelope,
  buildFrameTargetGapPlan,
  createFrameTargetGapLibrary,
  mergeFrameTargetGapReports
} from '../pc/engines/frame-pacing/turbos/target-gap/library.js';

function report(overrides = {}) {
  return {
    turbo: 'frame-pacing.target-gap',
    state: 'healthy-target-gap',
    sampleCount: 4,
    minimumSamples: 2,
    persistenceThreshold: 2,
    criticalThreshold: 10,
    elevatedThreshold: 3,
    observedCount: 4,
    incompleteCount: 0,
    noDisplayCount: 0,
    noObservationCount: 0,
    criticalCount: 0,
    elevatedCount: 0,
    maximumGap: 2,
    confidence: 1,
    ...overrides
  };
}

describe('frame-pacing target-gap library', () => {
  test('publishes identity and merges target-gap evidence', () => {
    const merged = mergeFrameTargetGapReports([
      report({ sampleCount: 2, observedCount: 2, criticalCount: 1, maximumGap: 12 }),
      report({ state: 'critical-gap-sustained', sampleCount: 6, observedCount: 5,
        criticalCount: 3, maximumGap: 20, confidence: 0.8333 })
    ]);

    expect(FRAME_TARGET_GAP_LIBRARY_ID).toBe('frame-pacing.target-gap.library');
    expect(FRAME_TARGET_GAP_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'critical-gap-sustained',
      sampleCount: 8,
      observedCount: 7,
      criticalCount: 4,
      maximumGap: 20,
      confidence: 0.875,
      recommendations: ['review-foreground-workload', 'hold-unapproved-display-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeFrameTargetGapReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      maximumGap: null, recommendations: ['collect-more-target-gap-samples']
    });
    expect(mergeFrameTargetGapReports([report({ state: 'no-display', sampleCount: 0,
      observedCount: 0, maximumGap: null, confidence: 0 })])).toMatchObject({
      state: 'no-display', confidence: 0, maximumGap: null,
      recommendations: ['keep-display-controls-disabled']
    });
    expect(mergeFrameTargetGapReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, maximumGap: null, confidence: 0 })])).toMatchObject({
      state: 'no-observation', recommendations: ['request-target-gap-observation']
    });
    expect(mergeFrameTargetGapReports([report({ state: 'incomplete-target-evidence',
      incompleteCount: 1 })])).toMatchObject({
      state: 'incomplete-target-evidence', recommendations: ['request-explicit-fps-target']
    });
    expect(mergeFrameTargetGapReports([report({ state: 'critical-gap-observed', criticalCount: 1 })])
    ).toMatchObject({ state: 'critical-gap-observed', recommendations: ['observe-next-target-gap-sample'] });
    expect(mergeFrameTargetGapReports([report({ state: 'elevated-gap-sustained', elevatedCount: 2 })])
    ).toMatchObject({ state: 'elevated-gap-sustained', recommendations: ['review-fps-target-gap'] });
    expect(mergeFrameTargetGapReports([report({ state: 'elevated-gap-observed', elevatedCount: 1 })])
    ).toMatchObject({ state: 'elevated-gap-observed', recommendations: ['observe-next-target-gap-sample'] });
    expect(mergeFrameTargetGapReports([report()])).toMatchObject({
      state: 'healthy-target-gap', recommendations: ['no-change']
    });
    expect(mergeFrameTargetGapReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, maximumGap: null, confidence: 0 })]).state).toBe('insufficient-data');
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeFrameTargetGapReports([
      report({ state: 'critical-gap-sustained', criticalCount: 2 }),
      report({ state: 'no-display', sampleCount: 0, observedCount: 0,
        maximumGap: null, confidence: 0 })
    ])).toMatchObject({ state: 'no-display' });
    const states = [
      ['critical-gap-sustained', 'critical-gap-review', 750],
      ['critical-gap-observed', 'critical-gap-observation', 1000],
      ['elevated-gap-sustained', 'elevated-gap-review', 1000],
      ['elevated-gap-observed', 'elevated-gap-observation', 1500],
      ['healthy-target-gap', 'healthy-target-observation', 5000],
      ['no-display', 'no-display-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['incomplete-target-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const unavailable = state === 'no-display' || state === 'no-observation';
      const sampleCount = unavailable ? 0 : 4;
      const confidence = unavailable ? 0 : 1;
      expect(buildFrameTargetGapPlan(report({ state, sampleCount,
        observedCount: sampleCount, maximumGap: unavailable ? null : 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildFrameTargetGapPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildFrameTargetGapPlan(report({ sampleCount: 0, observedCount: 0,
      maximumGap: null, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildFrameTargetGapEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: FRAME_TARGET_GAP_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createFrameTargetGapLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(FRAME_TARGET_GAP_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      maximumGap: null, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeFrameTargetGapReports(null)).toThrow('reports must be an array');
    expect(() => mergeFrameTargetGapReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeFrameTargetGapReports([null])).toThrow('report must be an object');
    expect(() => mergeFrameTargetGapReports([[]])).toThrow('report must be an object');
    expect(() => mergeFrameTargetGapReports([report({ turbo: 'other' })]))
      .toThrow('requires a target-gap turbo report');
    expect(() => mergeFrameTargetGapReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeFrameTargetGapReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeFrameTargetGapReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeFrameTargetGapReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeFrameTargetGapReports([report({ criticalThreshold: -1 })]))
      .toThrow('thresholds must be non-negative');
    expect(() => mergeFrameTargetGapReports([report({ elevatedThreshold: 10 })]))
      .toThrow('elevatedThreshold must be below criticalThreshold');
    for (const field of ['observedCount', 'incompleteCount', 'noDisplayCount',
      'noObservationCount', 'criticalCount', 'elevatedCount']) {
      expect(() => mergeFrameTargetGapReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeFrameTargetGapReports([report({ maximumGap: -1 })]))
      .toThrow('maximumGap must be null or non-negative');
    expect(() => mergeFrameTargetGapReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildFrameTargetGapEnvelope(report())).toThrow('trigger is required');
    expect(() => buildFrameTargetGapEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildFrameTargetGapEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildFrameTargetGapEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
