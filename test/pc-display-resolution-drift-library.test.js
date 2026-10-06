import {
  DISPLAY_RESOLUTION_DRIFT_LIBRARY_ID,
  DISPLAY_RESOLUTION_DRIFT_LIBRARY_VERSION,
  buildDisplayResolutionDriftEnvelope,
  buildDisplayResolutionDriftPlan,
  createDisplayResolutionDriftLibrary,
  mergeDisplayResolutionDriftReports
} from '../pc/engines/display-pipeline/turbos/resolution-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'display-pipeline.resolution-drift',
    state: 'stable-resolution',
    sampleCount,
    minimumSamples: 2,
    changeThreshold: 1,
    observedCount: sampleCount,
    incompleteCount: 0,
    noDisplayCount: 0,
    noObservationCount: 0,
    transitionCount: 0,
    comparisonCount: Math.max(0, sampleCount - 1),
    latestResolution: sampleCount === 0 ? null : '1920x1080',
    latestWidth: sampleCount === 0 ? null : 1920,
    latestHeight: sampleCount === 0 ? null : 1080,
    confidence: sampleCount === 0 ? 0 : 1,
    ...overrides
  };
}

describe('display-pipeline resolution-drift library', () => {
  test('publishes identity and merges resolution evidence', () => {
    const merged = mergeDisplayResolutionDriftReports([
      report({ sampleCount: 2, observedCount: 2, transitionCount: 1,
        comparisonCount: 1, latestResolution: '2560x1440', latestWidth: 2560, latestHeight: 1440 }),
      report({ state: 'resolution-drift-sustained', sampleCount: 6, observedCount: 5,
        transitionCount: 3, comparisonCount: 5, latestResolution: '3840x2160',
        latestWidth: 3840, latestHeight: 2160, confidence: 0.8333 })
    ]);
    expect(DISPLAY_RESOLUTION_DRIFT_LIBRARY_ID).toBe('display-pipeline.resolution-drift.library');
    expect(DISPLAY_RESOLUTION_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'resolution-drift-sustained',
      sampleCount: 8, observedCount: 7, transitionCount: 4, comparisonCount: 6,
      latestResolution: '3840x2160', latestWidth: 3840, latestHeight: 2160, confidence: 0.875,
      recommendations: ['review-resolution-workload', 'hold-unapproved-display-policy'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeDisplayResolutionDriftReports([])).toMatchObject({ state: 'insufficient-data',
      reportCount: 0, confidence: 0, latestResolution: null, recommendations: ['collect-more-resolution-samples'] });
    expect(mergeDisplayResolutionDriftReports([report({ state: 'no-display', sampleCount: 0,
      observedCount: 0, latestResolution: null, latestWidth: null, latestHeight: null, confidence: 0 })]))
      .toMatchObject({ state: 'no-display', recommendations: ['keep-display-controls-disabled'] });
    expect(mergeDisplayResolutionDriftReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, latestResolution: null, latestWidth: null, latestHeight: null, confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', recommendations: ['request-resolution-observation'] });
    expect(mergeDisplayResolutionDriftReports([report({ state: 'incomplete-resolution-evidence', incompleteCount: 1 })]))
      .toMatchObject({ state: 'incomplete-resolution-evidence', recommendations: ['request-complete-resolution-evidence'] });
    expect(mergeDisplayResolutionDriftReports([report({ state: 'resolution-drift-observed', transitionCount: 1 })]))
      .toMatchObject({ state: 'resolution-drift-observed', recommendations: ['observe-next-resolution-sample'] });
    expect(mergeDisplayResolutionDriftReports([report()])).toMatchObject({ state: 'stable-resolution', recommendations: ['no-change'] });
    expect(mergeDisplayResolutionDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, comparisonCount: 0, latestResolution: null, latestWidth: null, latestHeight: null, confidence: 0 })]).state)
      .toBe('insufficient-data');
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeDisplayResolutionDriftReports([
      report({ state: 'resolution-drift-sustained', transitionCount: 2 }),
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0,
        latestResolution: null, latestWidth: null, latestHeight: null, confidence: 0 })
    ])).toMatchObject({ state: 'no-observation' });
    const states = [
      ['resolution-drift-sustained', 'resolution-review', 750],
      ['resolution-drift-observed', 'resolution-observation', 1000],
      ['stable-resolution', 'stable-resolution-observation', 5000],
      ['no-display', 'no-display-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['incomplete-resolution-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const unavailable = state === 'no-display' || state === 'no-observation';
      const sampleCount = unavailable ? 0 : 4;
      expect(buildDisplayResolutionDriftPlan(report({ state, sampleCount,
        observedCount: sampleCount, latestResolution: unavailable ? null : '1920x1080',
        latestWidth: unavailable ? null : 1920, latestHeight: unavailable ? null : 1080 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence: unavailable ? 0 : 1 });
    }
    expect(buildDisplayResolutionDriftPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildDisplayResolutionDriftPlan(report({ sampleCount: 0, observedCount: 0,
      latestResolution: null, latestWidth: null, latestHeight: null, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildDisplayResolutionDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: DISPLAY_RESOLUTION_DRIFT_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createDisplayResolutionDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(DISPLAY_RESOLUTION_DRIFT_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0, latestResolution: null,
      latestWidth: null, latestHeight: null, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, fields, triggers, and clocks', () => {
    expect(() => mergeDisplayResolutionDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeDisplayResolutionDriftReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeDisplayResolutionDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeDisplayResolutionDriftReports([[]])).toThrow('report must be an object');
    expect(() => mergeDisplayResolutionDriftReports([report({ turbo: 'other' })])).toThrow('requires a resolution-drift turbo report');
    expect(() => mergeDisplayResolutionDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeDisplayResolutionDriftReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be non-negative');
    expect(() => mergeDisplayResolutionDriftReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeDisplayResolutionDriftReports([report({ changeThreshold: 0 })])).toThrow('changeThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noDisplayCount', 'noObservationCount', 'transitionCount', 'comparisonCount']) {
      expect(() => mergeDisplayResolutionDriftReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeDisplayResolutionDriftReports([report({ latestResolution: 1 })])).toThrow('latestResolution must be a string or null');
    expect(() => mergeDisplayResolutionDriftReports([report({ latestWidth: 0 })])).toThrow('latestWidth must be a positive integer or null');
    expect(() => mergeDisplayResolutionDriftReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildDisplayResolutionDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildDisplayResolutionDriftEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildDisplayResolutionDriftEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildDisplayResolutionDriftEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
