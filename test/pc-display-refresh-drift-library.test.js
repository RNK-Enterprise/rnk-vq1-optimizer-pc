import {
  DISPLAY_REFRESH_DRIFT_LIBRARY_ID,
  DISPLAY_REFRESH_DRIFT_LIBRARY_VERSION,
  buildDisplayRefreshDriftEnvelope,
  buildDisplayRefreshDriftPlan,
  createDisplayRefreshDriftLibrary,
  mergeDisplayRefreshDriftReports
} from '../pc/engines/display-pipeline/turbos/refresh-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'display-pipeline.refresh-drift',
    state: 'stable-refresh',
    sampleCount,
    minimumSamples: 2,
    changeThreshold: 1,
    deltaThreshold: 5,
    observedCount: sampleCount,
    incompleteCount: 0,
    noDisplayCount: 0,
    noObservationCount: 0,
    deltaCount: 0,
    comparisonCount: Math.max(0, sampleCount - 1),
    maximumDelta: sampleCount === 0 ? null : 0,
    latestRefreshRateHz: sampleCount === 0 ? null : 144,
    confidence: sampleCount === 0 ? 0 : 1,
    ...overrides
  };
}

describe('display-pipeline refresh-drift library', () => {
  test('publishes identity and merges refresh evidence', () => {
    const merged = mergeDisplayRefreshDriftReports([
      report({ sampleCount: 2, observedCount: 2, deltaCount: 1, comparisonCount: 1,
        maximumDelta: 60, latestRefreshRateHz: 120 }),
      report({ state: 'refresh-drift-sustained', sampleCount: 6, observedCount: 5,
        deltaCount: 3, comparisonCount: 5, maximumDelta: 72, latestRefreshRateHz: 144,
        confidence: 0.8333 })
    ]);
    expect(DISPLAY_REFRESH_DRIFT_LIBRARY_ID).toBe('display-pipeline.refresh-drift.library');
    expect(DISPLAY_REFRESH_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'refresh-drift-sustained',
      sampleCount: 8, observedCount: 7, deltaCount: 4, comparisonCount: 6,
      maximumDelta: 72, latestRefreshRateHz: 144, confidence: 0.875,
      recommendations: ['review-refresh-stability', 'hold-unapproved-display-policy'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeDisplayRefreshDriftReports([])).toMatchObject({ state: 'insufficient-data', reportCount: 0,
      confidence: 0, maximumDelta: 0, latestRefreshRateHz: null, recommendations: ['collect-more-refresh-samples'] });
    expect(mergeDisplayRefreshDriftReports([report({ state: 'no-display', sampleCount: 0,
      observedCount: 0, maximumDelta: null, latestRefreshRateHz: null, confidence: 0 })]))
      .toMatchObject({ state: 'no-display', recommendations: ['keep-display-controls-disabled'] });
    expect(mergeDisplayRefreshDriftReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, maximumDelta: null, latestRefreshRateHz: null, confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', recommendations: ['request-refresh-observation'] });
    expect(mergeDisplayRefreshDriftReports([report({ state: 'incomplete-refresh-evidence', incompleteCount: 1 })]))
      .toMatchObject({ state: 'incomplete-refresh-evidence', recommendations: ['request-complete-refresh-evidence'] });
    expect(mergeDisplayRefreshDriftReports([report({ state: 'refresh-drift-observed', deltaCount: 1 })]))
      .toMatchObject({ state: 'refresh-drift-observed', recommendations: ['observe-next-refresh-sample'] });
    expect(mergeDisplayRefreshDriftReports([report()])).toMatchObject({ state: 'stable-refresh', recommendations: ['no-change'] });
    expect(mergeDisplayRefreshDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, comparisonCount: 0, maximumDelta: null, latestRefreshRateHz: null, confidence: 0 })]).state)
      .toBe('insufficient-data');
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeDisplayRefreshDriftReports([
      report({ state: 'refresh-drift-sustained', deltaCount: 2 }),
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0,
        maximumDelta: null, latestRefreshRateHz: null, confidence: 0 })
    ])).toMatchObject({ state: 'no-observation' });
    const states = [
      ['refresh-drift-sustained', 'refresh-review', 750],
      ['refresh-drift-observed', 'refresh-observation', 1000],
      ['stable-refresh', 'stable-refresh-observation', 5000],
      ['no-display', 'no-display-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['incomplete-refresh-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const unavailable = state === 'no-display' || state === 'no-observation';
      const sampleCount = unavailable ? 0 : 4;
      expect(buildDisplayRefreshDriftPlan(report({ state, sampleCount,
        observedCount: sampleCount, maximumDelta: unavailable ? null : 0,
        latestRefreshRateHz: unavailable ? null : 144 }), 'interactive')).toMatchObject({
        environment: 'interactive', mode, intervalMs, state, confidence: unavailable ? 0 : 1
      });
    }
    expect(buildDisplayRefreshDriftPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildDisplayRefreshDriftPlan(report({ sampleCount: 0, observedCount: 0,
      maximumDelta: null, latestRefreshRateHz: null, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildDisplayRefreshDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: DISPLAY_REFRESH_DRIFT_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createDisplayRefreshDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(DISPLAY_REFRESH_DRIFT_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      maximumDelta: null, latestRefreshRateHz: null, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, metrics, triggers, and clocks', () => {
    expect(() => mergeDisplayRefreshDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeDisplayRefreshDriftReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeDisplayRefreshDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeDisplayRefreshDriftReports([[]])).toThrow('report must be an object');
    expect(() => mergeDisplayRefreshDriftReports([report({ turbo: 'other' })])).toThrow('requires a refresh-drift turbo report');
    expect(() => mergeDisplayRefreshDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeDisplayRefreshDriftReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be non-negative');
    expect(() => mergeDisplayRefreshDriftReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeDisplayRefreshDriftReports([report({ changeThreshold: 0 })])).toThrow('changeThreshold must be from 1 to 64');
    expect(() => mergeDisplayRefreshDriftReports([report({ deltaThreshold: -1 })])).toThrow('deltaThreshold must be non-negative');
    for (const field of ['observedCount', 'incompleteCount', 'noDisplayCount', 'noObservationCount', 'deltaCount', 'comparisonCount']) {
      expect(() => mergeDisplayRefreshDriftReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeDisplayRefreshDriftReports([report({ maximumDelta: -1 })])).toThrow('maximumDelta must be null or non-negative');
    expect(() => mergeDisplayRefreshDriftReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildDisplayRefreshDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildDisplayRefreshDriftEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildDisplayRefreshDriftEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildDisplayRefreshDriftEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
