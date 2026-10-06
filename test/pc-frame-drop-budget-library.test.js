import {
  FRAME_DROP_BUDGET_LIBRARY_ID,
  FRAME_DROP_BUDGET_LIBRARY_VERSION,
  buildFrameDropBudgetEnvelope,
  buildFrameDropBudgetPlan,
  createFrameDropBudgetLibrary,
  mergeFrameDropBudgetReports
} from '../pc/engines/frame-pacing/turbos/drop-budget/library.js';

function report(overrides = {}) {
  return {
    turbo: 'frame-pacing.drop-budget',
    state: 'normal-drop-budget',
    sampleCount: 4,
    minimumSamples: 2,
    persistenceThreshold: 2,
    criticalThreshold: 10,
    elevatedThreshold: 5,
    observedCount: 4,
    incompleteCount: 0,
    noDisplayCount: 0,
    noObservationCount: 0,
    criticalCount: 0,
    elevatedCount: 0,
    maximumDroppedPercent: 2,
    confidence: 1,
    ...overrides
  };
}

describe('frame-pacing drop-budget library', () => {
  test('publishes identity and merges drop evidence', () => {
    const merged = mergeFrameDropBudgetReports([
      report({ sampleCount: 2, observedCount: 2, criticalCount: 1,
        maximumDroppedPercent: 12 }),
      report({ state: 'critical-drop-sustained', sampleCount: 6, observedCount: 5,
        criticalCount: 3, maximumDroppedPercent: 20, confidence: 0.8333 })
    ]);

    expect(FRAME_DROP_BUDGET_LIBRARY_ID).toBe('frame-pacing.drop-budget.library');
    expect(FRAME_DROP_BUDGET_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'critical-drop-sustained',
      sampleCount: 8,
      observedCount: 7,
      criticalCount: 4,
      maximumDroppedPercent: 20,
      confidence: 0.875,
      recommendations: ['protect-foreground', 'hold-unapproved-display-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeFrameDropBudgetReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      maximumDroppedPercent: null, recommendations: ['collect-more-dropped-frame-samples']
    });
    expect(mergeFrameDropBudgetReports([report({ state: 'no-display', sampleCount: 0,
      observedCount: 0, maximumDroppedPercent: null, confidence: 0 })])).toMatchObject({
      state: 'no-display', confidence: 0, maximumDroppedPercent: null,
      recommendations: ['keep-display-controls-disabled']
    });
    expect(mergeFrameDropBudgetReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, maximumDroppedPercent: null, confidence: 0 })])).toMatchObject({
      state: 'no-observation', recommendations: ['request-dropped-frame-observation']
    });
    expect(mergeFrameDropBudgetReports([report({ state: 'incomplete-drop-evidence',
      incompleteCount: 1 })])).toMatchObject({
      state: 'incomplete-drop-evidence', recommendations: ['request-complete-drop-evidence']
    });
    expect(mergeFrameDropBudgetReports([report({ state: 'critical-drop-observed', criticalCount: 1 })])
    ).toMatchObject({ state: 'critical-drop-observed', recommendations: ['observe-next-drop-sample'] });
    expect(mergeFrameDropBudgetReports([report({ state: 'elevated-drop-sustained', elevatedCount: 2 })])
    ).toMatchObject({ state: 'elevated-drop-sustained', recommendations: ['review-frame-drop-budget'] });
    expect(mergeFrameDropBudgetReports([report({ state: 'elevated-drop-observed', elevatedCount: 1 })])
    ).toMatchObject({ state: 'elevated-drop-observed', recommendations: ['observe-next-drop-sample'] });
    expect(mergeFrameDropBudgetReports([report()])).toMatchObject({
      state: 'normal-drop-budget', recommendations: ['no-change']
    });
    expect(mergeFrameDropBudgetReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, maximumDroppedPercent: null, confidence: 0 })]).state).toBe('insufficient-data');
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeFrameDropBudgetReports([
      report({ state: 'critical-drop-sustained', criticalCount: 2 }),
      report({ state: 'no-display', sampleCount: 0, observedCount: 0,
        maximumDroppedPercent: null, confidence: 0 })
    ])).toMatchObject({ state: 'no-display' });
    const states = [
      ['critical-drop-sustained', 'critical-drop-review', 750],
      ['critical-drop-observed', 'critical-drop-observation', 1000],
      ['elevated-drop-sustained', 'elevated-drop-review', 1000],
      ['elevated-drop-observed', 'elevated-drop-observation', 1500],
      ['normal-drop-budget', 'normal-drop-observation', 5000],
      ['no-display', 'no-display-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['incomplete-drop-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const unavailable = state === 'no-display' || state === 'no-observation';
      const sampleCount = unavailable ? 0 : 4;
      const confidence = unavailable ? 0 : 1;
      expect(buildFrameDropBudgetPlan(report({ state, sampleCount,
        observedCount: sampleCount, maximumDroppedPercent: unavailable ? null : 2 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildFrameDropBudgetPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildFrameDropBudgetPlan(report({ sampleCount: 0, observedCount: 0,
      maximumDroppedPercent: null, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildFrameDropBudgetEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: FRAME_DROP_BUDGET_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createFrameDropBudgetLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(FRAME_DROP_BUDGET_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      maximumDroppedPercent: null, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeFrameDropBudgetReports(null)).toThrow('reports must be an array');
    expect(() => mergeFrameDropBudgetReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeFrameDropBudgetReports([null])).toThrow('report must be an object');
    expect(() => mergeFrameDropBudgetReports([[]])).toThrow('report must be an object');
    expect(() => mergeFrameDropBudgetReports([report({ turbo: 'other' })]))
      .toThrow('requires a drop-budget turbo report');
    expect(() => mergeFrameDropBudgetReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeFrameDropBudgetReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeFrameDropBudgetReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeFrameDropBudgetReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeFrameDropBudgetReports([report({ criticalThreshold: 101 })]))
      .toThrow('thresholds must be between 0 and 100');
    expect(() => mergeFrameDropBudgetReports([report({ elevatedThreshold: -1 })]))
      .toThrow('thresholds must be between 0 and 100');
    expect(() => mergeFrameDropBudgetReports([report({ elevatedThreshold: 10 })]))
      .toThrow('elevatedThreshold must be below criticalThreshold');
    for (const field of ['observedCount', 'incompleteCount', 'noDisplayCount',
      'noObservationCount', 'criticalCount', 'elevatedCount']) {
      expect(() => mergeFrameDropBudgetReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeFrameDropBudgetReports([report({ maximumDroppedPercent: -1 })]))
      .toThrow('maximumDroppedPercent must be null or between 0 and 100');
    expect(() => mergeFrameDropBudgetReports([report({ maximumDroppedPercent: 101 })]))
      .toThrow('maximumDroppedPercent must be null or between 0 and 100');
    expect(() => mergeFrameDropBudgetReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildFrameDropBudgetEnvelope(report())).toThrow('trigger is required');
    expect(() => buildFrameDropBudgetEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildFrameDropBudgetEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildFrameDropBudgetEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
