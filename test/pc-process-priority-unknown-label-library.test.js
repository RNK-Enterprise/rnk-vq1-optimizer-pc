import {
  PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_ID,
  PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_VERSION,
  buildProcessPriorityUnknownLabelEnvelope,
  buildProcessPriorityUnknownLabelPlan,
  createProcessPriorityUnknownLabelLibrary,
  mergeProcessPriorityUnknownLabelReports
} from '../pc/engines/process-priority/turbos/unknown-label/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'process-priority.unknown-label',
    state: 'documented-priority',
    sampleCount,
    minimumSamples: 2,
    persistenceThreshold: 2,
    rateThreshold: 0.25,
    processCount: 2,
    unknownCount: 0,
    latestUnknownCount: 0,
    latestUnknownRate: 0,
    observedCount: sampleCount,
    incompleteCount: 0,
    noProcessCount: 0,
    unknownSamples: 0,
    maximumRate: 0,
    confidence: 1,
    ...overrides
  };
}

describe('process-priority unknown-label library', () => {
  test('publishes identity and merges label evidence', () => {
    const merged = mergeProcessPriorityUnknownLabelReports([
      report({ sampleCount: 2, unknownCount: 1, latestUnknownCount: 1, latestUnknownRate: 0.5,
        unknownSamples: 1, maximumRate: 0.5 }),
      report({ state: 'unknown-priority-sustained', sampleCount: 6, observedCount: 5, unknownCount: 3,
        latestUnknownCount: 1, latestUnknownRate: 0.5, unknownSamples: 2, maximumRate: 0.5,
        confidence: 0.8333 })
    ]);

    expect(PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_ID).toBe('process-priority.unknown-label.library');
    expect(PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'unknown-priority-sustained',
      sampleCount: 8,
      unknownCount: 4,
      latestUnknownCount: 1,
      latestUnknownRate: 0.5,
      unknownSamples: 3,
      maximumRate: 0.5,
      confidence: 0.875,
      recommendations: ['document-priority-labels', 'hold-unknown-priority-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeProcessPriorityUnknownLabelReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      latestUnknownCount: 0, latestUnknownRate: 0,
      recommendations: ['collect-more-priority-samples']
    });
    expect(mergeProcessPriorityUnknownLabelReports([report({ state: 'no-processes', sampleCount: 1,
      processCount: 0, observedCount: 0, noProcessCount: 1, confidence: 0 })])
    ).toMatchObject({ state: 'no-processes', recommendations: ['no-process-priority-review'] });
    expect(mergeProcessPriorityUnknownLabelReports([report({ state: 'incomplete-priority-evidence',
      incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-priority-evidence', recommendations: ['request-priority-environment-evidence']
    });
    expect(mergeProcessPriorityUnknownLabelReports([report({ state: 'unknown-priority-observed',
      unknownCount: 1, latestUnknownCount: 1, latestUnknownRate: 0.5, unknownSamples: 1,
      maximumRate: 0.5 })])).toMatchObject({
      state: 'unknown-priority-observed', recommendations: ['observe-next-priority-label']
    });
    expect(mergeProcessPriorityUnknownLabelReports([report()])).toMatchObject({
      state: 'documented-priority', recommendations: ['no-change']
    });
    expect(mergeProcessPriorityUnknownLabelReports([report({ state: 'insufficient-data', sampleCount: 1,
      processCount: 1, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeProcessPriorityUnknownLabelReports([report({ state: 'insufficient-data', sampleCount: 0,
      processCount: 0, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeProcessPriorityUnknownLabelReports([
      report({ state: 'unknown-priority-sustained' }),
      report({ state: 'no-processes', sampleCount: 1, processCount: 0, observedCount: 0,
        noProcessCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-processes' });
    const states = [
      ['unknown-priority-sustained', 'priority-label-review', 750],
      ['unknown-priority-observed', 'priority-label-observation', 1000],
      ['documented-priority', 'documented-priority-observation', 5000],
      ['no-processes', 'no-process-observation', 10000],
      ['incomplete-priority-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-processes';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildProcessPriorityUnknownLabelPlan(report({ state, sampleCount,
        processCount: empty ? 0 : 2, observedCount: empty ? 0 : sampleCount,
        noProcessCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildProcessPriorityUnknownLabelPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildProcessPriorityUnknownLabelPlan(report({ sampleCount: 0, processCount: 0,
      observedCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildProcessPriorityUnknownLabelEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessPriorityUnknownLabelLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, processCount: 0,
      observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, rates, triggers, and clocks', () => {
    expect(() => mergeProcessPriorityUnknownLabelReports(null)).toThrow('reports must be an array');
    expect(() => mergeProcessPriorityUnknownLabelReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeProcessPriorityUnknownLabelReports([null])).toThrow('report must be an object');
    expect(() => mergeProcessPriorityUnknownLabelReports([[]])).toThrow('report must be an object');
    expect(() => mergeProcessPriorityUnknownLabelReports([report({ turbo: 'other' })]))
      .toThrow('requires an unknown-label turbo report');
    expect(() => mergeProcessPriorityUnknownLabelReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeProcessPriorityUnknownLabelReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeProcessPriorityUnknownLabelReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeProcessPriorityUnknownLabelReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeProcessPriorityUnknownLabelReports([report({ rateThreshold: 2 })]))
      .toThrow('rateThreshold must be between 0 and 1');
    for (const field of ['processCount', 'observedCount', 'incompleteCount', 'noProcessCount',
      'unknownSamples']) {
      expect(() => mergeProcessPriorityUnknownLabelReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeProcessPriorityUnknownLabelReports([report({ unknownCount: -1 })]))
      .toThrow('unknownCount must be non-negative');
    expect(() => mergeProcessPriorityUnknownLabelReports([report({ latestUnknownCount: -1 })]))
      .toThrow('latestUnknownCount must be non-negative');
    expect(() => mergeProcessPriorityUnknownLabelReports([report({ latestUnknownRate: 2 })]))
      .toThrow('latestUnknownRate must be between 0 and 1');
    expect(() => mergeProcessPriorityUnknownLabelReports([report({ maximumRate: 2 })]))
      .toThrow('maximumRate must be between 0 and 1');
    expect(() => mergeProcessPriorityUnknownLabelReports([report({ confidence: 2 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildProcessPriorityUnknownLabelEnvelope(report())).toThrow('trigger is required');
    expect(() => buildProcessPriorityUnknownLabelEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildProcessPriorityUnknownLabelEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildProcessPriorityUnknownLabelEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
