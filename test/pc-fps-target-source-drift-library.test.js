import {
  FPS_TARGET_SOURCE_DRIFT_LIBRARY_ID,
  FPS_TARGET_SOURCE_DRIFT_LIBRARY_VERSION,
  buildFpsTargetSourceDriftEnvelope,
  buildFpsTargetSourceDriftPlan,
  createFpsTargetSourceDriftLibrary,
  mergeFpsTargetSourceDriftReports
} from '../pc/engines/fps-target/turbos/target-source-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'fps-target.target-source-drift',
    state: 'stable-target-source',
    sampleCount,
    minimumSamples: 2,
    changeThreshold: 1,
    observedCount: sampleCount,
    incompleteCount: 0,
    noDisplayCount: 0,
    noObservationCount: 0,
    userCount: 0,
    displayCount: sampleCount,
    observationCount: 0,
    transitionCount: 0,
    comparisonCount: Math.max(0, sampleCount - 1),
    latestSource: 'display',
    latestTarget: 144,
    confidence: 1,
    ...overrides
  };
}

describe('fps-target target-source-drift library', () => {
  test('publishes identity and merges provenance evidence', () => {
    const merged = mergeFpsTargetSourceDriftReports([
      report({ sampleCount: 2, observedCount: 2, displayCount: 1, userCount: 1,
        transitionCount: 1, comparisonCount: 1, latestSource: 'user', latestTarget: 120 }),
      report({ state: 'source-drift-sustained', sampleCount: 6, observedCount: 5,
        displayCount: 3, observationCount: 2, transitionCount: 3, comparisonCount: 5,
        latestSource: 'observation', latestTarget: 90, confidence: 0.8333 })
    ]);

    expect(FPS_TARGET_SOURCE_DRIFT_LIBRARY_ID).toBe('fps-target.target-source-drift.library');
    expect(FPS_TARGET_SOURCE_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'source-drift-sustained',
      sampleCount: 8,
      observedCount: 7,
      userCount: 1,
      transitionCount: 4,
      comparisonCount: 6,
      latestSource: 'observation',
      latestTarget: 90,
      confidence: 0.875,
      recommendations: ['review-target-provenance', 'hold-unapproved-fps-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeFpsTargetSourceDriftReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      latestSource: 'unavailable', latestTarget: null,
      recommendations: ['collect-more-target-source-samples']
    });
    expect(mergeFpsTargetSourceDriftReports([report({ state: 'no-display', sampleCount: 0,
      observedCount: 0, latestSource: 'unavailable', latestTarget: null, confidence: 0 })])
    ).toMatchObject({ state: 'no-display', recommendations: ['keep-fps-controls-disabled'] });
    expect(mergeFpsTargetSourceDriftReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, latestSource: 'unavailable', latestTarget: null, confidence: 0 })])
    ).toMatchObject({ state: 'no-observation', recommendations: ['request-fps-target-observation'] });
    expect(mergeFpsTargetSourceDriftReports([report({ state: 'incomplete-target-evidence',
      incompleteCount: 1, latestSource: 'unavailable', latestTarget: null })])).toMatchObject({
      state: 'incomplete-target-evidence', recommendations: ['request-target-source-evidence']
    });
    expect(mergeFpsTargetSourceDriftReports([report({ state: 'source-drift-observed',
      transitionCount: 1 })])).toMatchObject({
      state: 'source-drift-observed', recommendations: ['observe-next-target-source']
    });
    expect(mergeFpsTargetSourceDriftReports([report()])).toMatchObject({
      state: 'stable-target-source', recommendations: ['no-change']
    });
    expect(mergeFpsTargetSourceDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, displayCount: 0, latestSource: 'unavailable', latestTarget: null,
      confidence: 0 })]).state).toBe('insufficient-data');
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeFpsTargetSourceDriftReports([
      report({ state: 'source-drift-sustained', transitionCount: 2 }),
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0,
        latestSource: 'unavailable', latestTarget: null, confidence: 0 })
    ])).toMatchObject({ state: 'no-observation' });
    const states = [
      ['source-drift-sustained', 'target-source-review', 750],
      ['source-drift-observed', 'target-source-observation', 1000],
      ['stable-target-source', 'stable-target-source-observation', 5000],
      ['no-display', 'no-display-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['incomplete-target-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const unavailable = state === 'no-display' || state === 'no-observation';
      const sampleCount = unavailable ? 0 : 4;
      const confidence = unavailable ? 0 : 1;
      expect(buildFpsTargetSourceDriftPlan(report({ state, sampleCount,
        observedCount: sampleCount, latestSource: unavailable ? 'unavailable' : 'display',
        latestTarget: unavailable ? null : 144 }), 'interactive')).toMatchObject({
        environment: 'interactive', mode, intervalMs, state, confidence
      });
    }
    expect(buildFpsTargetSourceDriftPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildFpsTargetSourceDriftPlan(report({ sampleCount: 0, observedCount: 0,
      latestSource: 'unavailable', latestTarget: null, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildFpsTargetSourceDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: FPS_TARGET_SOURCE_DRIFT_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createFpsTargetSourceDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(FPS_TARGET_SOURCE_DRIFT_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      latestSource: 'unavailable', latestTarget: null, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, sources, triggers, and clocks', () => {
    expect(() => mergeFpsTargetSourceDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeFpsTargetSourceDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeFpsTargetSourceDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeFpsTargetSourceDriftReports([[]])).toThrow('report must be an object');
    expect(() => mergeFpsTargetSourceDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a target-source drift turbo report');
    expect(() => mergeFpsTargetSourceDriftReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeFpsTargetSourceDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeFpsTargetSourceDriftReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeFpsTargetSourceDriftReports([report({ changeThreshold: 0 })]))
      .toThrow('changeThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noDisplayCount',
      'noObservationCount', 'userCount', 'displayCount', 'observationCount',
      'transitionCount', 'comparisonCount']) {
      expect(() => mergeFpsTargetSourceDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeFpsTargetSourceDriftReports([report({ latestSource: 'other' })]))
      .toThrow('invalid latest source');
    expect(() => mergeFpsTargetSourceDriftReports([report({ latestTarget: -1 })]))
      .toThrow('latestTarget must be null or non-negative');
    expect(() => mergeFpsTargetSourceDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildFpsTargetSourceDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildFpsTargetSourceDriftEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildFpsTargetSourceDriftEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildFpsTargetSourceDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
