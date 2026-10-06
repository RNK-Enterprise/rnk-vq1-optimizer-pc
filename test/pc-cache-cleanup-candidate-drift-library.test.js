import {
  CACHE_CANDIDATE_DRIFT_LIBRARY_ID,
  CACHE_CANDIDATE_DRIFT_LIBRARY_VERSION,
  buildCacheCandidateDriftEnvelope,
  buildCacheCandidateDriftPlan,
  createCacheCandidateDriftLibrary,
  mergeCacheCandidateDriftReports
} from '../pc/engines/cache-cleanup/turbos/candidate-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  const comparisonCount = overrides.comparisonCount ?? Math.max(0, sampleCount - 1);
  return {
    turbo: 'cache-cleanup.candidate-drift', state: 'stable-preview', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, candidateCount: 2,
    namedCandidateCount: 2, candidateBytes: 20, reviewCount: 0, comparisonCount,
    changeCount: 0, addedCount: 0, removedCount: 0, sizeChangeCount: 0,
    finalEnvironment: 'interactive', confidence: 1, ...overrides
  };
}

describe('cache-cleanup candidate-drift library', () => {
  test('publishes identity and merges candidate evidence', () => {
    const merged = mergeCacheCandidateDriftReports([
      report({ sampleCount: 2, comparisonCount: 1 }),
      report({ state: 'candidate-drift-sustained', sampleCount: 4, candidateCount: 1,
        namedCandidateCount: 1, candidateBytes: 30, reviewCount: 1, comparisonCount: 3,
        changeCount: 2, addedCount: 2, removedCount: 1, sizeChangeCount: 1,
        finalEnvironment: 'headless', confidence: 1 })
    ]);
    expect(CACHE_CANDIDATE_DRIFT_LIBRARY_ID).toBe('cache-cleanup.candidate-drift.library');
    expect(CACHE_CANDIDATE_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'candidate-drift-sustained',
      sampleCount: 6, candidateCount: 1, namedCandidateCount: 3, candidateBytes: 30,
      reviewCount: 1, comparisonCount: 4, changeCount: 2, addedCount: 2,
      removedCount: 1, sizeChangeCount: 1, finalEnvironment: 'headless',
      confidence: 1, recommendations: ['review-candidate-drift-without-file-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('merges every state and builds every state plan', () => {
    expect(mergeCacheCandidateDriftReports([])).toMatchObject({ state: 'insufficient-data',
      confidence: 0, recommendations: ['collect-more-cache-candidate-samples'] });
    expect(mergeCacheCandidateDriftReports([report({ sampleCount: 0, candidateCount: 0,
      namedCandidateCount: 0, candidateBytes: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
    expect(mergeCacheCandidateDriftReports([report({ state: 'review-required', reviewCount: 1 })])
      .recommendations).toEqual(['review-cache-ownership']);
    expect(mergeCacheCandidateDriftReports([report({ state: 'candidate-drift-observed',
      comparisonCount: 1, changeCount: 1 })]).recommendations).toEqual(['observe-candidate-stability']);
    expect(mergeCacheCandidateDriftReports([report({ state: 'no-candidates', candidateCount: 0,
      namedCandidateCount: 0, candidateBytes: 0, confidence: 0.5 })]).recommendations)
      .toEqual(['no-cache-cleanup-review']);
    expect(mergeCacheCandidateDriftReports([report()]).recommendations)
      .toEqual(['preview-safe-cache-candidates']);
    expect(mergeCacheCandidateDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      candidateCount: 0, namedCandidateCount: 0, candidateBytes: 0, comparisonCount: 0, confidence: 0 })]).state)
      .toBe('insufficient-data');
    const states = [
      ['review-required', 'ownership-review', 750],
      ['candidate-drift-sustained', 'candidate-review', 1000],
      ['candidate-drift-observed', 'candidate-observation', 1500],
      ['no-candidates', 'empty-observation', 10000],
      ['insufficient-data', 'sample-bootstrap', 2000],
      ['stable-preview', 'stable-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-candidates' || state === 'insufficient-data';
      const sampleCount = state === 'insufficient-data' ? 0 : (empty ? 1 : 4);
      const candidateCount = empty ? 0 : 2;
      expect(buildCacheCandidateDriftPlan(report({ state, sampleCount, candidateCount,
        namedCandidateCount: candidateCount, candidateBytes: candidateCount * 10,
        reviewCount: state === 'review-required' ? 1 : 0,
        comparisonCount: Math.max(0, sampleCount - 1), confidence: candidateCount > 0 ? 1 : 0 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildCacheCandidateDriftPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildCacheCandidateDriftPlan(report({ sampleCount: 0, candidateCount: 0,
      namedCandidateCount: 0, candidateBytes: 0, comparisonCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildCacheCandidateDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: CACHE_CANDIDATE_DRIFT_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createCacheCandidateDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(CACHE_CANDIDATE_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, candidateCount: 0, namedCandidateCount: 0,
      candidateBytes: 0, comparisonCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, totals, environments, triggers, and clocks', () => {
    expect(() => mergeCacheCandidateDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeCacheCandidateDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCacheCandidateDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeCacheCandidateDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a candidate-drift turbo report');
    expect(() => mergeCacheCandidateDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeCacheCandidateDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeCacheCandidateDriftReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeCacheCandidateDriftReports([report({ persistenceThreshold: 65 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['candidateCount', 'namedCandidateCount', 'reviewCount']) {
      expect(() => mergeCacheCandidateDriftReports([report({ [field]: 4097 })])).toThrow('must be from 0 to 4096');
    }
    expect(() => mergeCacheCandidateDriftReports([report({ candidateBytes: -1 })]))
      .toThrow('candidateBytes must be a safe non-negative number');
    expect(() => mergeCacheCandidateDriftReports([report({ comparisonCount: 4 })]))
      .toThrow('comparisonCount must fit inside the sample window');
    for (const field of ['changeCount', 'sizeChangeCount']) {
      expect(() => mergeCacheCandidateDriftReports([report({ comparisonCount: 1, [field]: 2 })]))
        .toThrow('must fit inside comparisonCount');
    }
    for (const field of ['addedCount', 'removedCount']) {
      expect(() => mergeCacheCandidateDriftReports([report({ [field]: 4097 })])).toThrow('must be from 0 to 4096');
    }
    expect(() => mergeCacheCandidateDriftReports([report({ finalEnvironment: 'other' })]))
      .toThrow('finalEnvironment must be normalized');
    expect(() => mergeCacheCandidateDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildCacheCandidateDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCacheCandidateDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
