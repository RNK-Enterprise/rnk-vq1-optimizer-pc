import {
  CACHE_OWNERSHIP_LIBRARY_ID,
  CACHE_OWNERSHIP_LIBRARY_VERSION,
  buildCacheOwnershipEnvelope,
  buildCacheOwnershipPlan,
  createCacheOwnershipLibrary,
  mergeCacheOwnershipReports
} from '../pc/engines/cache-cleanup/turbos/ownership-boundary/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  const comparisonCount = overrides.comparisonCount ?? Math.max(0, sampleCount - 1);
  return {
    turbo: 'cache-cleanup.ownership-boundary', state: 'stable-ownership', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, cacheCount: 2, userOwnedCount: 0,
    systemSafeCount: 2, ambiguousCount: 0, knownCount: 2, comparisonCount,
    changeCount: 0, userOwnedChangeCount: 0, systemSafeChangeCount: 0,
    ambiguousChangeCount: 0, finalEnvironment: 'headless', confidence: 1, ...overrides
  };
}

describe('cache-cleanup ownership-boundary library', () => {
  test('publishes identity and merges ownership evidence', () => {
    const merged = mergeCacheOwnershipReports([
      report({ sampleCount: 2, comparisonCount: 1 }),
      report({ state: 'ownership-drift-sustained', sampleCount: 4, cacheCount: 3,
        userOwnedCount: 0, systemSafeCount: 3, ambiguousCount: 0, knownCount: 3,
        comparisonCount: 3, changeCount: 2, systemSafeChangeCount: 2,
        finalEnvironment: 'interactive', confidence: 1 })
    ]);
    expect(CACHE_OWNERSHIP_LIBRARY_ID).toBe('cache-cleanup.ownership-boundary.library');
    expect(CACHE_OWNERSHIP_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'ownership-drift-sustained',
      sampleCount: 6, cacheCount: 3, userOwnedCount: 0, systemSafeCount: 3,
      ambiguousCount: 0, knownCount: 3, comparisonCount: 4, changeCount: 2,
      systemSafeChangeCount: 2, finalEnvironment: 'interactive', confidence: 1,
      recommendations: ['review-ownership-drift-without-file-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('merges every state and builds every state plan', () => {
    expect(mergeCacheOwnershipReports([])).toMatchObject({ state: 'insufficient-data',
      confidence: 0, recommendations: ['collect-more-cache-ownership-samples'] });
    expect(mergeCacheOwnershipReports([report({ sampleCount: 0, cacheCount: 0, systemSafeCount: 0,
      knownCount: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
    expect(mergeCacheOwnershipReports([report({ state: 'user-owned-present', cacheCount: 1,
      userOwnedCount: 1, systemSafeCount: 0, knownCount: 1 })]).recommendations)
      .toEqual(['preserve-user-owned-cache-boundary']);
    expect(mergeCacheOwnershipReports([report({ state: 'ambiguous-review', cacheCount: 1,
      systemSafeCount: 0, ambiguousCount: 1, knownCount: 0, confidence: 0 })]).recommendations)
      .toEqual(['review-ambiguous-cache-ownership']);
    expect(mergeCacheOwnershipReports([report({ state: 'ownership-drift-observed',
      comparisonCount: 1, changeCount: 1 })]).recommendations)
      .toEqual(['observe-cache-ownership-stability']);
    expect(mergeCacheOwnershipReports([report()]).recommendations)
      .toEqual(['preview-safe-cache-candidates']);
    expect(mergeCacheOwnershipReports([report({ state: 'insufficient-data', sampleCount: 1,
      cacheCount: 0, systemSafeCount: 0, knownCount: 0, comparisonCount: 0, confidence: 0 })]).state)
      .toBe('insufficient-data');
    const states = [
      ['user-owned-present', 'user-boundary', 750],
      ['ambiguous-review', 'ownership-review', 750],
      ['ownership-drift-sustained', 'ownership-review', 1000],
      ['ownership-drift-observed', 'ownership-observation', 1500],
      ['insufficient-data', 'sample-bootstrap', 2000],
      ['stable-ownership', 'stable-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'insufficient-data';
      const sampleCount = empty ? 0 : 4;
      expect(buildCacheOwnershipPlan(report({ state, sampleCount, cacheCount: empty ? 0 : 2,
        userOwnedCount: state === 'user-owned-present' ? 1 : 0,
        systemSafeCount: state === 'user-owned-present' ? 1 : 2,
        ambiguousCount: state === 'ambiguous-review' ? 1 : 0,
        knownCount: state === 'ambiguous-review' ? 1 : 2,
        comparisonCount: Math.max(0, sampleCount - 1), confidence: empty ? 0 : 1 }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildCacheOwnershipPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildCacheOwnershipPlan(report({ cacheCount: 0, systemSafeCount: 0, knownCount: 0,
      sampleCount: 0, comparisonCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildCacheOwnershipEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: CACHE_OWNERSHIP_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createCacheOwnershipLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(CACHE_OWNERSHIP_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ cacheCount: 0, systemSafeCount: 0, knownCount: 0,
      sampleCount: 0, comparisonCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, environments, triggers, and clocks', () => {
    expect(() => mergeCacheOwnershipReports(null)).toThrow('reports must be an array');
    expect(() => mergeCacheOwnershipReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeCacheOwnershipReports([null])).toThrow('report must be an object');
    expect(() => mergeCacheOwnershipReports([report({ turbo: 'other' })]))
      .toThrow('requires an ownership-boundary turbo report');
    expect(() => mergeCacheOwnershipReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeCacheOwnershipReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeCacheOwnershipReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeCacheOwnershipReports([report({ persistenceThreshold: 65 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['cacheCount', 'userOwnedCount', 'systemSafeCount', 'ambiguousCount', 'knownCount']) {
      expect(() => mergeCacheOwnershipReports([report({ [field]: 4097 })])).toThrow('must be from 0 to 4096');
    }
    expect(() => mergeCacheOwnershipReports([report({ comparisonCount: 4 })]))
      .toThrow('comparisonCount must fit inside the sample window');
    expect(() => mergeCacheOwnershipReports([report({ comparisonCount: 1, changeCount: 2 })]))
      .toThrow('changeCount must fit inside comparisonCount');
    for (const field of ['userOwnedChangeCount', 'systemSafeChangeCount', 'ambiguousChangeCount']) {
      expect(() => mergeCacheOwnershipReports([report({ comparisonCount: 1, [field]: 2 })]))
        .toThrow('must fit inside comparisonCount');
    }
    expect(() => mergeCacheOwnershipReports([report({ finalEnvironment: 'other' })]))
      .toThrow('finalEnvironment must be normalized');
    expect(() => mergeCacheOwnershipReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildCacheOwnershipEnvelope(report())).toThrow('trigger is required');
    expect(() => buildCacheOwnershipEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
