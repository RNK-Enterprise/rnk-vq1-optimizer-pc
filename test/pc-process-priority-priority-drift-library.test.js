import {
  PROCESS_PRIORITY_DRIFT_LIBRARY_ID,
  PROCESS_PRIORITY_DRIFT_LIBRARY_VERSION,
  buildProcessPriorityDriftEnvelope,
  buildProcessPriorityDriftPlan,
  createProcessPriorityDriftLibrary,
  mergeProcessPriorityDriftReports
} from '../pc/engines/process-priority/turbos/priority-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'process-priority.priority-drift',
    state: 'stable-priority',
    sampleCount,
    minimumSamples: 2,
    changeThreshold: 1,
    observedCount: sampleCount,
    incompleteCount: 0,
    noProcessCount: 0,
    transitionCount: 0,
    comparisonCount: Math.max(0, sampleCount - 1),
    latestPrioritySignature: 'game:normal',
    confidence: 1,
    ...overrides
  };
}

describe('process-priority priority-drift library', () => {
  test('publishes identity and merges movement evidence', () => {
    const merged = mergeProcessPriorityDriftReports([
      report({ sampleCount: 2, observedCount: 2, transitionCount: 1, comparisonCount: 1,
        latestPrioritySignature: 'game:high' }),
      report({ state: 'priority-drift-sustained', sampleCount: 6, observedCount: 5,
        transitionCount: 3, comparisonCount: 5, latestPrioritySignature: 'game:realtime',
        confidence: 0.8333 })
    ]);

    expect(PROCESS_PRIORITY_DRIFT_LIBRARY_ID).toBe('process-priority.priority-drift.library');
    expect(PROCESS_PRIORITY_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'priority-drift-sustained',
      sampleCount: 8,
      observedCount: 7,
      transitionCount: 4,
      comparisonCount: 6,
      latestPrioritySignature: 'game:realtime',
      confidence: 0.875,
      recommendations: ['review-priority-drift', 'hold-unapproved-priority-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeProcessPriorityDriftReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      latestPrioritySignature: null, recommendations: ['collect-more-priority-samples']
    });
    expect(mergeProcessPriorityDriftReports([report({ state: 'no-processes', sampleCount: 1,
      observedCount: 0, noProcessCount: 1, comparisonCount: 0, latestPrioritySignature: '', confidence: 0 })])
    ).toMatchObject({ state: 'no-processes', recommendations: ['no-process-priority-review'] });
    expect(mergeProcessPriorityDriftReports([report({ state: 'incomplete-priority-evidence',
      incompleteCount: 1, latestPrioritySignature: null })])).toMatchObject({
      state: 'incomplete-priority-evidence', recommendations: ['request-documented-priority-observation']
    });
    expect(mergeProcessPriorityDriftReports([report({ state: 'priority-drift-observed',
      transitionCount: 1 })])).toMatchObject({
      state: 'priority-drift-observed', recommendations: ['observe-next-priority-sample']
    });
    expect(mergeProcessPriorityDriftReports([report()])).toMatchObject({
      state: 'stable-priority', recommendations: ['no-change']
    });
    expect(mergeProcessPriorityDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, comparisonCount: 0, latestPrioritySignature: null, confidence: 0 })]).state)
      .toBe('insufficient-data');
    expect(mergeProcessPriorityDriftReports([report({ state: 'insufficient-data', sampleCount: 0,
      observedCount: 0, comparisonCount: 0, latestPrioritySignature: null, confidence: 0 })]))
      .toMatchObject({ state: 'insufficient-data', confidence: 0 });
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeProcessPriorityDriftReports([
      report({ state: 'priority-drift-sustained', transitionCount: 2 }),
      report({ state: 'no-processes', sampleCount: 1, observedCount: 0, noProcessCount: 1,
        comparisonCount: 0,
        latestPrioritySignature: '', confidence: 0 })
    ])).toMatchObject({ state: 'no-processes' });
    const states = [
      ['priority-drift-sustained', 'priority-drift-review', 750],
      ['priority-drift-observed', 'priority-drift-observation', 1000],
      ['stable-priority', 'stable-priority-observation', 5000],
      ['no-processes', 'no-process-observation', 10000],
      ['incomplete-priority-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-processes';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildProcessPriorityDriftPlan(report({ state, sampleCount,
        observedCount: empty ? 0 : sampleCount, noProcessCount: empty ? 1 : 0,
        latestPrioritySignature: empty ? '' : 'game:normal', confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildProcessPriorityDriftPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildProcessPriorityDriftPlan(report({ sampleCount: 0, observedCount: 0,
      latestPrioritySignature: null, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildProcessPriorityDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: PROCESS_PRIORITY_DRIFT_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessPriorityDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(PROCESS_PRIORITY_DRIFT_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0,
      latestPrioritySignature: null, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeProcessPriorityDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeProcessPriorityDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeProcessPriorityDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeProcessPriorityDriftReports([[]])).toThrow('report must be an object');
    expect(() => mergeProcessPriorityDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a priority-drift turbo report');
    expect(() => mergeProcessPriorityDriftReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeProcessPriorityDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeProcessPriorityDriftReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeProcessPriorityDriftReports([report({ changeThreshold: 0 })]))
      .toThrow('changeThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noProcessCount',
      'transitionCount', 'comparisonCount']) {
      expect(() => mergeProcessPriorityDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeProcessPriorityDriftReports([report({ latestPrioritySignature: 1 })]))
      .toThrow('latestPrioritySignature must be null or a string');
    expect(() => mergeProcessPriorityDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildProcessPriorityDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildProcessPriorityDriftEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildProcessPriorityDriftEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildProcessPriorityDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
