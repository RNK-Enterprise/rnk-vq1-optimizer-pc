import {
  PROCESS_PRIORITY_VOLATILITY_LIBRARY_ID,
  PROCESS_PRIORITY_VOLATILITY_LIBRARY_VERSION,
  buildProcessPriorityVolatilityEnvelope,
  buildProcessPriorityVolatilityPlan,
  createProcessPriorityVolatilityLibrary,
  mergeProcessPriorityVolatilityReports
} from '../pc/engines/process-priority/turbos/priority-volatility/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'process-priority.priority-volatility',
    state: 'stable-priority-state',
    sampleCount,
    minimumSamples: 2,
    changeThreshold: 1,
    processCount: 2,
    observedCount: sampleCount,
    incompleteCount: 0,
    noProcessCount: 0,
    volatilityCount: 0,
    comparisonCount: Math.max(0, sampleCount - 1),
    latestPriorityStateSignature: 'game:normal:false:false',
    confidence: 1,
    ...overrides
  };
}

describe('process-priority priority-volatility library', () => {
  test('publishes identity and merges volatility evidence', () => {
    const merged = mergeProcessPriorityVolatilityReports([
      report({ sampleCount: 2, volatilityCount: 1, comparisonCount: 1,
        latestPriorityStateSignature: 'game:high:true:false' }),
      report({ state: 'priority-volatility-sustained', sampleCount: 6, observedCount: 5,
        volatilityCount: 3, comparisonCount: 5,
        latestPriorityStateSignature: 'game:realtime:true:true', confidence: 0.8333 })
    ]);

    expect(PROCESS_PRIORITY_VOLATILITY_LIBRARY_ID)
      .toBe('process-priority.priority-volatility.library');
    expect(PROCESS_PRIORITY_VOLATILITY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({
      reportCount: 2,
      state: 'priority-volatility-sustained',
      sampleCount: 8,
      observedCount: 7,
      volatilityCount: 4,
      comparisonCount: 6,
      latestPriorityStateSignature: 'game:realtime:true:true',
      confidence: 0.875,
      recommendations: ['review-priority-state-volatility', 'hold-unapproved-priority-policy']
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeProcessPriorityVolatilityReports([])).toMatchObject({
      state: 'insufficient-data', reportCount: 0, confidence: 0,
      latestPriorityStateSignature: null,
      recommendations: ['collect-more-priority-state-samples']
    });
    expect(mergeProcessPriorityVolatilityReports([report({ state: 'no-processes', sampleCount: 1,
      processCount: 0, observedCount: 0, noProcessCount: 1, comparisonCount: 0, confidence: 0 })])
    ).toMatchObject({ state: 'no-processes', recommendations: ['no-process-volatility-review'] });
    expect(mergeProcessPriorityVolatilityReports([report({ state: 'incomplete-volatility-evidence',
      incompleteCount: 1, latestPriorityStateSignature: null, confidence: 0 })])).toMatchObject({
      state: 'incomplete-volatility-evidence', recommendations: ['request-complete-priority-state-evidence']
    });
    expect(mergeProcessPriorityVolatilityReports([report({ state: 'priority-volatility-observed',
      volatilityCount: 1 })])).toMatchObject({
      state: 'priority-volatility-observed', recommendations: ['observe-next-priority-state']
    });
    expect(mergeProcessPriorityVolatilityReports([report()])).toMatchObject({
      state: 'stable-priority-state', recommendations: ['no-change']
    });
    expect(mergeProcessPriorityVolatilityReports([report({ state: 'insufficient-data', sampleCount: 1,
      processCount: 1, observedCount: 0, comparisonCount: 0, confidence: 0 })]).state)
      .toBe('insufficient-data');
    expect(mergeProcessPriorityVolatilityReports([report({ state: 'insufficient-data', sampleCount: 0,
      processCount: 0, observedCount: 0, comparisonCount: 0,
      latestPriorityStateSignature: null, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeProcessPriorityVolatilityReports([
      report({ state: 'priority-volatility-sustained' }),
      report({ state: 'no-processes', sampleCount: 1, processCount: 0, observedCount: 0,
        noProcessCount: 1, comparisonCount: 0, confidence: 0 })
    ])).toMatchObject({ state: 'no-processes' });
    const states = [
      ['priority-volatility-sustained', 'priority-volatility-review', 750],
      ['priority-volatility-observed', 'priority-volatility-observation', 1000],
      ['stable-priority-state', 'stable-priority-state-observation', 5000],
      ['no-processes', 'no-process-observation', 10000],
      ['incomplete-volatility-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-processes';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildProcessPriorityVolatilityPlan(report({ state, sampleCount,
        processCount: empty ? 0 : 2, observedCount: empty ? 0 : sampleCount,
        noProcessCount: empty ? 1 : 0, comparisonCount: Math.max(0, sampleCount - 1), confidence }),
      'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildProcessPriorityVolatilityPlan(report(), 'headless'))
      .toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildProcessPriorityVolatilityPlan(report({ sampleCount: 0, processCount: 0,
      observedCount: 0, comparisonCount: 0, latestPriorityStateSignature: null, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildProcessPriorityVolatilityEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({
      library: PROCESS_PRIORITY_VOLATILITY_LIBRARY_ID,
      libraryVersion: 1,
      trigger: 'health.interval',
      generatedAt: '1970-01-01T00:00:00.000Z'
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessPriorityVolatilityLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(PROCESS_PRIORITY_VOLATILITY_LIBRARY_ID);
    expect(library.version).toBe(1);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, processCount: 0,
      observedCount: 0, comparisonCount: 0, latestPriorityStateSignature: null, confidence: 0 }),
    'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, triggers, and clocks', () => {
    expect(() => mergeProcessPriorityVolatilityReports(null)).toThrow('reports must be an array');
    expect(() => mergeProcessPriorityVolatilityReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeProcessPriorityVolatilityReports([null])).toThrow('report must be an object');
    expect(() => mergeProcessPriorityVolatilityReports([[]])).toThrow('report must be an object');
    expect(() => mergeProcessPriorityVolatilityReports([report({ turbo: 'other' })]))
      .toThrow('requires a priority-volatility turbo report');
    expect(() => mergeProcessPriorityVolatilityReports([report({ state: 'other' })]))
      .toThrow('invalid state');
    expect(() => mergeProcessPriorityVolatilityReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be non-negative');
    expect(() => mergeProcessPriorityVolatilityReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeProcessPriorityVolatilityReports([report({ changeThreshold: 0 })]))
      .toThrow('changeThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noProcessCount',
      'volatilityCount', 'comparisonCount']) {
      expect(() => mergeProcessPriorityVolatilityReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeProcessPriorityVolatilityReports([report({ processCount: 4097 })]))
      .toThrow('processCount must be from 0 to 4096');
    expect(() => mergeProcessPriorityVolatilityReports([report({ latestPriorityStateSignature: 1 })]))
      .toThrow('latest signature must be null or a string');
    expect(() => mergeProcessPriorityVolatilityReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildProcessPriorityVolatilityEnvelope(report())).toThrow('trigger is required');
    expect(() => buildProcessPriorityVolatilityEnvelope(report(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildProcessPriorityVolatilityEnvelope(report(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildProcessPriorityVolatilityEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
