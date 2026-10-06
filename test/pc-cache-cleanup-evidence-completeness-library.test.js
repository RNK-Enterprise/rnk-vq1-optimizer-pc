import {
  CACHE_EVIDENCE_LIBRARY_ID,
  CACHE_EVIDENCE_LIBRARY_VERSION,
  buildCacheEvidenceEnvelope,
  buildCacheEvidencePlan,
  createCacheEvidenceLibrary,
  mergeCacheEvidenceReports
} from '../pc/engines/cache-cleanup/turbos/evidence-completeness/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  const comparisonCount = overrides.comparisonCount ?? Math.max(0, sampleCount - 1);
  return {
    turbo: 'cache-cleanup.evidence-completeness', state: 'complete-evidence', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, minimumCompleteness: 1,
    cacheCount: 2, completeCount: 2, incompleteCount: 0, completeness: 1,
    comparisonCount, changeCount: 0, completenessChangeCount: 0, incompleteChangeCount: 0,
    finalEnvironment: 'interactive', confidence: 1, ...overrides
  };
}

describe('cache-cleanup evidence-completeness library', () => {
  test('publishes identity and merges evidence reports', () => {
    const merged = mergeCacheEvidenceReports([
      report({ sampleCount: 2, comparisonCount: 1 }),
      report({ state: 'evidence-drift-sustained', sampleCount: 4, cacheCount: 2,
        completeCount: 2, incompleteCount: 0, completeness: 1, comparisonCount: 3,
        changeCount: 2, completenessChangeCount: 2, incompleteChangeCount: 2,
        finalEnvironment: 'headless' })
    ]);
    expect(CACHE_EVIDENCE_LIBRARY_ID).toBe('cache-cleanup.evidence-completeness.library');
    expect(CACHE_EVIDENCE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'evidence-drift-sustained',
      sampleCount: 6, cacheCount: 2, completeCount: 2, incompleteCount: 0,
      completeness: 1, comparisonCount: 4, changeCount: 2, completenessChangeCount: 2,
      incompleteChangeCount: 2, finalEnvironment: 'headless', confidence: 1,
      recommendations: ['review-cache-evidence-drift'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('merges every state and builds every state plan', () => {
    expect(mergeCacheEvidenceReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-cache-evidence-samples'] });
    expect(mergeCacheEvidenceReports([report({ sampleCount: 0, cacheCount: 0, completeCount: 0,
      completeness: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
    expect(mergeCacheEvidenceReports([report({ state: 'incomplete-evidence', cacheCount: 1,
      completeCount: 0, incompleteCount: 1, completeness: 0, confidence: 0 })]).recommendations)
      .toEqual(['request-complete-cache-metadata']);
    expect(mergeCacheEvidenceReports([report({ state: 'evidence-drift-observed', comparisonCount: 1,
      changeCount: 1 })]).recommendations).toEqual(['observe-cache-evidence-stability']);
    expect(mergeCacheEvidenceReports([report({ state: 'no-cache-evidence', cacheCount: 0,
      completeCount: 0, completeness: 0, confidence: 0 })]).recommendations)
      .toEqual(['no-cache-cleanup-review']);
    expect(mergeCacheEvidenceReports([report()]).recommendations)
      .toEqual(['preview-safe-cache-candidates']);
    expect(mergeCacheEvidenceReports([report({ state: 'insufficient-data', sampleCount: 1,
      cacheCount: 0, completeCount: 0, completeness: 0, comparisonCount: 0, confidence: 0 })]).state)
      .toBe('insufficient-data');
    const states = [
      ['incomplete-evidence', 'metadata-bootstrap', 750],
      ['evidence-drift-sustained', 'evidence-review', 1000],
      ['evidence-drift-observed', 'evidence-observation', 1500],
      ['no-cache-evidence', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 2000],
      ['complete-evidence', 'stable-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-cache-evidence' || state === 'insufficient-data';
      const sampleCount = state === 'insufficient-data' ? 0 : (empty ? 1 : 4);
      const completeCount = empty ? 0 : (state === 'incomplete-evidence' ? 0 : 2);
      const completeness = completeCount === 0 ? 0 : 1;
      expect(buildCacheEvidencePlan(report({ state, sampleCount, cacheCount: empty ? 0 : 2,
        completeCount, incompleteCount: empty ? 0 : 2 - completeCount, completeness,
        comparisonCount: Math.max(0, sampleCount - 1), confidence: completeness }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildCacheEvidencePlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildCacheEvidencePlan(report({ sampleCount: 0, cacheCount: 0, completeCount: 0,
      completeness: 0, comparisonCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildCacheEvidenceEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: CACHE_EVIDENCE_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createCacheEvidenceLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(CACHE_EVIDENCE_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, cacheCount: 0, completeCount: 0,
      completeness: 0, comparisonCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, ratios, environments, triggers, and clocks', () => {
    expect(() => mergeCacheEvidenceReports(null)).toThrow('reports must be an array');
    expect(() => mergeCacheEvidenceReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCacheEvidenceReports([null])).toThrow('report must be an object');
    expect(() => mergeCacheEvidenceReports([report({ turbo: 'other' })]))
      .toThrow('requires an evidence-completeness turbo report');
    expect(() => mergeCacheEvidenceReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeCacheEvidenceReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeCacheEvidenceReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeCacheEvidenceReports([report({ persistenceThreshold: 65 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeCacheEvidenceReports([report({ minimumCompleteness: 1.1 })]))
      .toThrow('minimumCompleteness must be between 0 and 1');
    for (const field of ['cacheCount', 'completeCount', 'incompleteCount']) {
      expect(() => mergeCacheEvidenceReports([report({ [field]: 4097 })])).toThrow('must be from 0 to 4096');
    }
    expect(() => mergeCacheEvidenceReports([report({ completeness: 1.1 })]))
      .toThrow('completeness must be between 0 and 1');
    expect(() => mergeCacheEvidenceReports([report({ comparisonCount: 4 })]))
      .toThrow('comparisonCount must fit inside the sample window');
    for (const field of ['changeCount', 'completenessChangeCount', 'incompleteChangeCount']) {
      expect(() => mergeCacheEvidenceReports([report({ comparisonCount: 1, [field]: 2 })]))
        .toThrow('must fit inside comparisonCount');
    }
    expect(() => mergeCacheEvidenceReports([report({ finalEnvironment: 'other' })]))
      .toThrow('finalEnvironment must be normalized');
    expect(() => mergeCacheEvidenceReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildCacheEvidenceEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCacheEvidenceEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
