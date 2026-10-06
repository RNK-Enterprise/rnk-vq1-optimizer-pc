import {
  FPS_REFRESH_HEADROOM_LIBRARY_ID,
  FPS_REFRESH_HEADROOM_LIBRARY_VERSION,
  buildFpsRefreshHeadroomEnvelope,
  buildFpsRefreshHeadroomPlan,
  createFpsRefreshHeadroomLibrary,
  mergeFpsRefreshHeadroomReports
} from '../pc/engines/fps-target/turbos/refresh-headroom/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'fps-target.refresh-headroom',
    state: 'headroom-available',
    sampleCount,
    minimumSamples: 2,
    persistenceThreshold: 2,
    minimumHeadroom: 3,
    observedCount: sampleCount,
    incompleteCount: 0,
    noDisplayCount: 0,
    noObservationCount: 0,
    tightCount: 0,
    minimumObservedHeadroom: sampleCount === 0 ? null : 4,
    maximumObservedHeadroom: sampleCount === 0 ? null : 8,
    confidence: sampleCount === 0 ? 0 : 1,
    ...overrides
  };
}

describe('fps-target refresh-headroom library', () => {
  test('publishes identity and merges headroom evidence', () => {
    const merged = mergeFpsRefreshHeadroomReports([
      report({ sampleCount: 2, observedCount: 2, tightCount: 1,
        minimumObservedHeadroom: 2, maximumObservedHeadroom: 6 }),
      report({ state: 'headroom-collapse-sustained', sampleCount: 6, observedCount: 5,
        tightCount: 3, minimumObservedHeadroom: 1, maximumObservedHeadroom: 10,
        confidence: 0.8333 })
    ]);

    expect(FPS_REFRESH_HEADROOM_LIBRARY_ID).toBe('fps-target.refresh-headroom.library');
    expect(FPS_REFRESH_HEADROOM_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'headroom-collapse-sustained',
      sampleCount: 8,
      observedCount: 7,
      tightCount: 4,
      minimumObservedHeadroom: 1,
      maximumObservedHeadroom: 10,
      confidence: 0.875,
      recommendations: ['review-refresh-headroom', 'hold-unapproved-fps-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeFpsRefreshHeadroomReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      minimumObservedHeadroom: null, maximumObservedHeadroom: null,
      recommendations: ['collect-more-refresh-headroom-samples']
    });
    expect(mergeFpsRefreshHeadroomReports([report({ state: 'no-display', sampleCount: 0,
      observedCount: 0, minimumObservedHeadroom: null, maximumObservedHeadroom: null,
      confidence: 0 })])).toMatchObject({ state: 'no-display', recommendations: ['keep-fps-controls-disabled'] });
    expect(mergeFpsRefreshHeadroomReports([report({ state: 'no-observation', sampleCount: 0,
      observedCount: 0, minimumObservedHeadroom: null, maximumObservedHeadroom: null,
      confidence: 0 })])).toMatchObject({ state: 'no-observation', recommendations: ['request-refresh-headroom-observation'] });
    expect(mergeFpsRefreshHeadroomReports([report({ state: 'incomplete-headroom-evidence',
      incompleteCount: 1 })])).toMatchObject({ state: 'incomplete-headroom-evidence', recommendations: ['request-refresh-and-fps-evidence'] });
    expect(mergeFpsRefreshHeadroomReports([report({ state: 'headroom-collapse-observed', tightCount: 1 })]))
      .toMatchObject({ state: 'headroom-collapse-observed', recommendations: ['observe-next-headroom-sample'] });
    expect(mergeFpsRefreshHeadroomReports([report()])).toMatchObject({
      state: 'headroom-available', recommendations: ['no-change']
    });
    expect(mergeFpsRefreshHeadroomReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, minimumObservedHeadroom: null, maximumObservedHeadroom: null,
      confidence: 0 })]).state).toBe('insufficient-data');
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeFpsRefreshHeadroomReports([
      report({ state: 'headroom-collapse-sustained', tightCount: 2 }),
      report({ state: 'no-observation', sampleCount: 0, observedCount: 0,
        minimumObservedHeadroom: null, maximumObservedHeadroom: null, confidence: 0 })
    ])).toMatchObject({ state: 'no-observation' });
    const states = [
      ['headroom-collapse-sustained', 'headroom-review', 750],
      ['headroom-collapse-observed', 'headroom-observation', 1000],
      ['headroom-available', 'headroom-available-observation', 5000],
      ['no-display', 'no-display-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['incomplete-headroom-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const unavailable = state === 'no-display' || state === 'no-observation';
      const sampleCount = unavailable ? 0 : 4;
      const confidence = unavailable ? 0 : 1;
      expect(buildFpsRefreshHeadroomPlan(report({ state, sampleCount,
        observedCount: sampleCount, minimumObservedHeadroom: unavailable ? null : 4,
        maximumObservedHeadroom: unavailable ? null : 8 }), 'interactive')).toMatchObject({
        environment: 'interactive', mode, intervalMs, state, confidence
      });
    }
    expect(buildFpsRefreshHeadroomPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildFpsRefreshHeadroomPlan(report({ sampleCount: 0, observedCount: 0,
      minimumObservedHeadroom: null, maximumObservedHeadroom: null, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildFpsRefreshHeadroomEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: FPS_REFRESH_HEADROOM_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createFpsRefreshHeadroomLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(FPS_REFRESH_HEADROOM_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      minimumObservedHeadroom: null, maximumObservedHeadroom: null, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeFpsRefreshHeadroomReports(null)).toThrow('reports must be an array');
    expect(() => mergeFpsRefreshHeadroomReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeFpsRefreshHeadroomReports([null])).toThrow('report must be an object');
    expect(() => mergeFpsRefreshHeadroomReports([[]])).toThrow('report must be an object');
    expect(() => mergeFpsRefreshHeadroomReports([report({ turbo: 'other' })]))
      .toThrow('requires a refresh-headroom turbo report');
    expect(() => mergeFpsRefreshHeadroomReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeFpsRefreshHeadroomReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeFpsRefreshHeadroomReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeFpsRefreshHeadroomReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeFpsRefreshHeadroomReports([report({ minimumHeadroom: -1 })]))
      .toThrow('minimumHeadroom must be non-negative');
    for (const field of ['observedCount', 'incompleteCount', 'noDisplayCount',
      'noObservationCount', 'tightCount']) {
      expect(() => mergeFpsRefreshHeadroomReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeFpsRefreshHeadroomReports([report({ minimumObservedHeadroom: -1 })]))
      .toThrow('minimumObservedHeadroom must be null or non-negative');
    expect(() => mergeFpsRefreshHeadroomReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildFpsRefreshHeadroomEnvelope(report())).toThrow('trigger is required');
    expect(() => buildFpsRefreshHeadroomEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildFpsRefreshHeadroomEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildFpsRefreshHeadroomEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
