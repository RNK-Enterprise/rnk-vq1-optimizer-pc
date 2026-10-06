import {
  FPS_USER_TARGET_GUARD_LIBRARY_ID,
  FPS_USER_TARGET_GUARD_LIBRARY_VERSION,
  buildFpsUserTargetGuardEnvelope,
  buildFpsUserTargetGuardPlan,
  createFpsUserTargetGuardLibrary,
  mergeFpsUserTargetGuardReports
} from '../pc/engines/fps-target/turbos/user-target-guard/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'fps-target.user-target-guard',
    state: 'user-target-preserved',
    sampleCount,
    minimumSamples: 2,
    persistenceThreshold: 2,
    observedCount: sampleCount,
    missingCount: 0,
    incompleteCount: 0,
    noDisplayCount: 0,
    noObservationCount: 0,
    withoutDisplayCount: 0,
    overRefreshCount: 0,
    minimumUserTarget: sampleCount === 0 ? null : 100,
    maximumUserTarget: sampleCount === 0 ? null : 120,
    confidence: sampleCount === 0 ? 0 : 1,
    ...overrides
  };
}

describe('fps-target user-target-guard library', () => {
  test('publishes identity and merges user-target evidence', () => {
    const merged = mergeFpsUserTargetGuardReports([
      report({ sampleCount: 2, observedCount: 2, overRefreshCount: 1,
        minimumUserTarget: 120, maximumUserTarget: 180 }),
      report({ state: 'target-over-refresh-sustained', sampleCount: 6, observedCount: 5,
        overRefreshCount: 3, minimumUserTarget: 140, maximumUserTarget: 240,
        confidence: 0.8333 })
    ]);

    expect(FPS_USER_TARGET_GUARD_LIBRARY_ID).toBe('fps-target.user-target-guard.library');
    expect(FPS_USER_TARGET_GUARD_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'target-over-refresh-sustained',
      sampleCount: 8,
      observedCount: 7,
      overRefreshCount: 4,
      minimumUserTarget: 120,
      maximumUserTarget: 240,
      confidence: 0.875,
      recommendations: ['review-user-target-against-refresh', 'preserve-user-intent']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeFpsUserTargetGuardReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      minimumUserTarget: null, maximumUserTarget: null,
      recommendations: ['collect-more-user-target-samples']
    });
    expect(mergeFpsUserTargetGuardReports([report({ state: 'no-display', sampleCount: 0,
      observedCount: 0, minimumUserTarget: null, maximumUserTarget: null, confidence: 0 })]))
      .toMatchObject({ state: 'no-display', recommendations: ['keep-fps-controls-disabled'] });
    expect(mergeFpsUserTargetGuardReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, minimumUserTarget: null, maximumUserTarget: null, confidence: 0 })]))
      .toMatchObject({ state: 'no-observation', recommendations: ['keep-user-target-observation-disabled'] });
    expect(mergeFpsUserTargetGuardReports([report({ state: 'incomplete-user-target-evidence',
      incompleteCount: 1 })])).toMatchObject({ state: 'incomplete-user-target-evidence', recommendations: ['request-complete-user-target-evidence'] });
    expect(mergeFpsUserTargetGuardReports([report({ state: 'no-user-target', missingCount: 4,
      observedCount: 0, minimumUserTarget: null, maximumUserTarget: null, confidence: 0 })]))
      .toMatchObject({ state: 'no-user-target', recommendations: ['preserve-no-user-target-state'] });
    expect(mergeFpsUserTargetGuardReports([report({ state: 'target-without-display', withoutDisplayCount: 1 })]))
      .toMatchObject({ state: 'target-without-display', recommendations: ['observe-display-before-comparing-target'] });
    expect(mergeFpsUserTargetGuardReports([report({ state: 'target-over-refresh-observed', overRefreshCount: 1 })]))
      .toMatchObject({ state: 'target-over-refresh-observed', recommendations: ['observe-next-user-target'] });
    expect(mergeFpsUserTargetGuardReports([report()])).toMatchObject({
      state: 'user-target-preserved', recommendations: ['no-change']
    });
    expect(mergeFpsUserTargetGuardReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, minimumUserTarget: null, maximumUserTarget: null, confidence: 0 })]).state)
      .toBe('insufficient-data');
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeFpsUserTargetGuardReports([
      report({ state: 'target-over-refresh-sustained', overRefreshCount: 2 }),
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0,
        minimumUserTarget: null, maximumUserTarget: null, confidence: 0 })
    ])).toMatchObject({ state: 'no-observation' });
    const states = [
      ['target-over-refresh-sustained', 'user-target-review', 750],
      ['target-over-refresh-observed', 'user-target-observation', 1000],
      ['target-without-display', 'display-bootstrap', 2000],
      ['no-user-target', 'no-user-target-observation', 5000],
      ['user-target-preserved', 'preserved-target-observation', 5000],
      ['no-display', 'no-display-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['incomplete-user-target-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const unavailable = state === 'no-display' || state === 'no-observation';
      const noTarget = state === 'no-user-target';
      const sampleCount = unavailable ? 0 : 4;
      const confidence = unavailable || noTarget ? 0 : 1;
      expect(buildFpsUserTargetGuardPlan(report({ state, sampleCount,
        observedCount: noTarget ? 0 : sampleCount,
        missingCount: noTarget ? sampleCount : 0,
        minimumUserTarget: unavailable || noTarget ? null : 100,
        maximumUserTarget: unavailable || noTarget ? null : 120 }), 'interactive')).toMatchObject({
        environment: 'interactive', mode, intervalMs, state, confidence
      });
    }
    expect(buildFpsUserTargetGuardPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildFpsUserTargetGuardPlan(report({ sampleCount: 0, observedCount: 0,
      minimumUserTarget: null, maximumUserTarget: null, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildFpsUserTargetGuardEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: FPS_USER_TARGET_GUARD_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createFpsUserTargetGuardLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(FPS_USER_TARGET_GUARD_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      minimumUserTarget: null, maximumUserTarget: null, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeFpsUserTargetGuardReports(null)).toThrow('reports must be an array');
    expect(() => mergeFpsUserTargetGuardReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeFpsUserTargetGuardReports([null])).toThrow('report must be an object');
    expect(() => mergeFpsUserTargetGuardReports([[]])).toThrow('report must be an object');
    expect(() => mergeFpsUserTargetGuardReports([report({ turbo: 'other' })]))
      .toThrow('requires a user-target guard turbo report');
    expect(() => mergeFpsUserTargetGuardReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeFpsUserTargetGuardReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeFpsUserTargetGuardReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeFpsUserTargetGuardReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'missingCount', 'incompleteCount', 'noDisplayCount',
      'noObservationCount', 'withoutDisplayCount', 'overRefreshCount']) {
      expect(() => mergeFpsUserTargetGuardReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeFpsUserTargetGuardReports([report({ minimumUserTarget: -1 })]))
      .toThrow('minimumUserTarget must be null or non-negative');
    expect(() => mergeFpsUserTargetGuardReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildFpsUserTargetGuardEnvelope(report())).toThrow('trigger is required');
    expect(() => buildFpsUserTargetGuardEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildFpsUserTargetGuardEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildFpsUserTargetGuardEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
