import {
  PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_ID,
  PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_VERSION,
  buildProcessLifecycleStateCoverageEnvelope,
  buildProcessLifecycleStateCoveragePlan,
  createProcessLifecycleStateCoverageLibrary,
  mergeProcessLifecycleStateCoverageReports
} from '../pc/engines/process-lifecycle/turbos/state-coverage/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'process-lifecycle.state-coverage', state: 'complete-state-observation', sampleCount,
    minimumSamples: 2, coverageThreshold: 1, persistenceThreshold: 2,
    processCount: 2, knownStateCount: 2, latestCoverage: 1,
    observedCount: sampleCount, incompleteCount: 0, noProcessCount: 0,
    lowCoverageCount: 0, confidence: 1, ...overrides
  };
}

describe('process-lifecycle state-coverage library', () => {
  test('publishes identity and merges coverage evidence', () => {
    const merged = mergeProcessLifecycleStateCoverageReports([
      report({ sampleCount: 2, knownStateCount: 1, latestCoverage: 0.5, lowCoverageCount: 1 }),
      report({ state: 'state-coverage-low-sustained', sampleCount: 6, observedCount: 5,
        knownStateCount: 1, latestCoverage: 0.5, lowCoverageCount: 3, confidence: 0.8333 })
    ]);
    expect(PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_ID).toBe('process-lifecycle.state-coverage.library');
    expect(PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'state-coverage-low-sustained', sampleCount: 8,
      knownStateCount: 1, latestCoverage: 0.5, lowCoverageCount: 4, confidence: 0.875,
      recommendations: ['review-process-state-coverage', 'hold-unknown-state-policy'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeProcessLifecycleStateCoverageReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeProcessLifecycleStateCoverageReports([report({ state: 'no-processes', sampleCount: 1,
      processCount: 0, knownStateCount: 0, latestCoverage: 0, observedCount: 0,
      noProcessCount: 1, confidence: 0 })])).toMatchObject({ state: 'no-processes', recommendations: ['no-process-lifecycle-review'] });
    expect(mergeProcessLifecycleStateCoverageReports([report({ state: 'incomplete-state-evidence',
      incompleteCount: 1, confidence: 0 })])).toMatchObject({ state: 'incomplete-state-evidence', recommendations: ['request-process-state-observation'] });
    expect(mergeProcessLifecycleStateCoverageReports([report({ state: 'state-coverage-low-observed',
      knownStateCount: 1, latestCoverage: 0.5, lowCoverageCount: 1 })]).recommendations).toEqual(['observe-next-state-sample']);
    expect(mergeProcessLifecycleStateCoverageReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeProcessLifecycleStateCoverageReports([report({ state: 'insufficient-data', sampleCount: 1,
      processCount: 1, knownStateCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeProcessLifecycleStateCoverageReports([report({ state: 'insufficient-data', sampleCount: 0,
      processCount: 0, knownStateCount: 0, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeProcessLifecycleStateCoverageReports([
      report({ state: 'state-coverage-low-sustained' }), report({ state: 'no-processes', sampleCount: 1,
        processCount: 0, knownStateCount: 0, latestCoverage: 0, observedCount: 0, noProcessCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-processes' });
    const states = [
      ['state-coverage-low-sustained', 'state-coverage-review', 750], ['state-coverage-low-observed', 'state-coverage-observation', 1000],
      ['complete-state-observation', 'complete-state-observation', 5000], ['no-processes', 'no-process-observation', 10000],
      ['incomplete-state-evidence', 'evidence-bootstrap', 1500], ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-processes';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildProcessLifecycleStateCoveragePlan(report({ state, sampleCount,
        processCount: empty ? 0 : 2, knownStateCount: empty ? 0 : 2,
        latestCoverage: empty ? 0 : 1, observedCount: empty ? 0 : sampleCount,
        noProcessCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildProcessLifecycleStateCoveragePlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildProcessLifecycleStateCoveragePlan(report({ sampleCount: 0, processCount: 0,
      knownStateCount: 0, latestCoverage: 0, observedCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildProcessLifecycleStateCoverageEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessLifecycleStateCoverageLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, processCount: 0, knownStateCount: 0,
      latestCoverage: 0, observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, ratios, triggers, and clocks', () => {
    expect(() => mergeProcessLifecycleStateCoverageReports(null)).toThrow('reports must be an array');
    expect(() => mergeProcessLifecycleStateCoverageReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeProcessLifecycleStateCoverageReports([null])).toThrow('report must be an object');
    expect(() => mergeProcessLifecycleStateCoverageReports([report({ turbo: 'other' })])).toThrow('requires a state-coverage turbo report');
    expect(() => mergeProcessLifecycleStateCoverageReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeProcessLifecycleStateCoverageReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be non-negative');
    expect(() => mergeProcessLifecycleStateCoverageReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeProcessLifecycleStateCoverageReports([report({ coverageThreshold: 2 })])).toThrow('coverageThreshold must be between 0 and 1');
    expect(() => mergeProcessLifecycleStateCoverageReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noProcessCount', 'lowCoverageCount']) {
      expect(() => mergeProcessLifecycleStateCoverageReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeProcessLifecycleStateCoverageReports([report({ processCount: 4097 })])).toThrow('processCount must be from 0 to 4096');
    expect(() => mergeProcessLifecycleStateCoverageReports([report({ knownStateCount: 3 })])).toThrow('knownStateCount must fit inside processCount');
    expect(() => mergeProcessLifecycleStateCoverageReports([report({ latestCoverage: 2 })])).toThrow('latestCoverage must be between 0 and 1');
    expect(() => mergeProcessLifecycleStateCoverageReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildProcessLifecycleStateCoverageEnvelope(report())).toThrow('trigger is required');
    expect(() => buildProcessLifecycleStateCoverageEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
