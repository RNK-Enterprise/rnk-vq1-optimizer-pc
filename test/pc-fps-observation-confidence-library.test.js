import {
  FPS_OBSERVATION_CONFIDENCE_LIBRARY_ID,
  FPS_OBSERVATION_CONFIDENCE_LIBRARY_VERSION,
  buildFpsObservationConfidenceEnvelope,
  buildFpsObservationConfidencePlan,
  createFpsObservationConfidenceLibrary,
  mergeFpsObservationConfidenceReports
} from '../pc/engines/fps-target/turbos/observation-confidence/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'fps-target.observation-confidence',
    state: 'high-confidence-observation',
    sampleCount,
    minimumSamples: 2,
    persistenceThreshold: 2,
    minimumConfidence: 0.75,
    completeCount: sampleCount,
    partialCount: 0,
    lowCount: 0,
    incompleteCount: 0,
    noDisplayCount: 0,
    noObservationCount: 0,
    averageConfidence: sampleCount === 0 ? null : 1,
    confidence: sampleCount === 0 ? 0 : 1,
    ...overrides
  };
}

describe('fps-target observation-confidence library', () => {
  test('publishes identity and merges confidence evidence', () => {
    const merged = mergeFpsObservationConfidenceReports([
      report({ sampleCount: 2, completeCount: 1, partialCount: 1,
        averageConfidence: 0.8 }),
      report({ state: 'low-confidence-sustained', sampleCount: 6, completeCount: 3,
        lowCount: 3, averageConfidence: 0.5, confidence: 0.8333 })
    ]);

    expect(FPS_OBSERVATION_CONFIDENCE_LIBRARY_ID).toBe('fps-target.observation-confidence.library');
    expect(FPS_OBSERVATION_CONFIDENCE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'low-confidence-sustained',
      sampleCount: 8,
      completeCount: 4,
      partialCount: 1,
      lowCount: 3,
      averageConfidence: 0.65,
      confidence: 0.65,
      recommendations: ['hold-target-decision', 'request-complete-fps-evidence']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves every aggregate state and empty confidence', () => {
    expect(mergeFpsObservationConfidenceReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0, averageConfidence: null,
      recommendations: ['collect-more-confidence-samples']
    });
    expect(mergeFpsObservationConfidenceReports([report({ state: 'no-display', sampleCount: 0,
      completeCount: 0, averageConfidence: null, confidence: 0 })])).toMatchObject({
      state: 'no-display', recommendations: ['keep-fps-controls-disabled']
    });
    expect(mergeFpsObservationConfidenceReports([report({ state: 'no-observation', sampleCount: 0,
      completeCount: 0, averageConfidence: null, confidence: 0 })])).toMatchObject({
      state: 'no-observation', recommendations: ['keep-confidence-observation-disabled']
    });
    expect(mergeFpsObservationConfidenceReports([report({ state: 'incomplete-observation',
      incompleteCount: 1 })])).toMatchObject({ state: 'incomplete-observation', recommendations: ['request-refresh-and-fps-evidence'] });
    expect(mergeFpsObservationConfidenceReports([report({ state: 'low-confidence-observed',
      lowCount: 1, averageConfidence: 0.5, confidence: 0.5 })])).toMatchObject({
      state: 'low-confidence-observed', recommendations: ['observe-next-confidence-sample']
    });
    expect(mergeFpsObservationConfidenceReports([report({ state: 'partial-observation',
      completeCount: 2, partialCount: 2, averageConfidence: 0.8, confidence: 0.8 })])).toMatchObject({
      state: 'partial-observation', recommendations: ['complete-optional-fps-evidence']
    });
    expect(mergeFpsObservationConfidenceReports([report()])).toMatchObject({
      state: 'high-confidence-observation', recommendations: ['no-change']
    });
    expect(mergeFpsObservationConfidenceReports([report({ state: 'insufficient-data', sampleCount: 1,
      completeCount: 0, averageConfidence: null, confidence: 0 })]).state).toBe('insufficient-data');
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeFpsObservationConfidenceReports([
      report({ state: 'low-confidence-sustained', lowCount: 2 }),
      report({ state: 'no-observation', sampleCount: 0, completeCount: 0,
        averageConfidence: null, confidence: 0 })
    ])).toMatchObject({ state: 'no-observation' });
    const states = [
      ['low-confidence-sustained', 'confidence-review', 750],
      ['low-confidence-observed', 'confidence-observation', 1000],
      ['partial-observation', 'evidence-completion', 1500],
      ['high-confidence-observation', 'high-confidence-observation', 5000],
      ['no-display', 'no-display-observation', 10000],
      ['no-observation', 'observation-bootstrap', 2000],
      ['incomplete-observation', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const unavailable = state === 'no-display' || state === 'no-observation';
      const sampleCount = unavailable ? 0 : 4;
      const confidence = unavailable ? 0 : 1;
      expect(buildFpsObservationConfidencePlan(report({ state, sampleCount,
        completeCount: unavailable ? 0 : 4, averageConfidence: unavailable ? null : 1,
        confidence }), 'interactive')).toMatchObject({
        environment: 'interactive', mode, intervalMs, state, confidence
      });
    }
    expect(buildFpsObservationConfidencePlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildFpsObservationConfidencePlan(report({ sampleCount: 0, completeCount: 0,
      averageConfidence: null, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildFpsObservationConfidenceEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: FPS_OBSERVATION_CONFIDENCE_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createFpsObservationConfidenceLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(FPS_OBSERVATION_CONFIDENCE_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, completeCount: 0,
      averageConfidence: null, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, metrics, triggers, and clocks', () => {
    expect(() => mergeFpsObservationConfidenceReports(null)).toThrow('reports must be an array');
    expect(() => mergeFpsObservationConfidenceReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeFpsObservationConfidenceReports([null])).toThrow('report must be an object');
    expect(() => mergeFpsObservationConfidenceReports([[]])).toThrow('report must be an object');
    expect(() => mergeFpsObservationConfidenceReports([report({ turbo: 'other' })]))
      .toThrow('requires an observation-confidence turbo report');
    expect(() => mergeFpsObservationConfidenceReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeFpsObservationConfidenceReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeFpsObservationConfidenceReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeFpsObservationConfidenceReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeFpsObservationConfidenceReports([report({ minimumConfidence: 0 })]))
      .toThrow('minimumConfidence must be above 0 and at most 1');
    for (const field of ['completeCount', 'partialCount', 'lowCount', 'incompleteCount',
      'noDisplayCount', 'noObservationCount']) {
      expect(() => mergeFpsObservationConfidenceReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeFpsObservationConfidenceReports([report({ averageConfidence: -1 })]))
      .toThrow('averageConfidence must be null or between 0 and 1');
    expect(() => mergeFpsObservationConfidenceReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildFpsObservationConfidenceEnvelope(report())).toThrow('trigger is required');
    expect(() => buildFpsObservationConfidenceEnvelope(report(), { trigger: '' })).toThrow('trigger is required');
    expect(() => buildFpsObservationConfidenceEnvelope(report(), { trigger: 1 })).toThrow('trigger is required');
    expect(() => buildFpsObservationConfidenceEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
