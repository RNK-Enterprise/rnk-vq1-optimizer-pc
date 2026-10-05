import {
  CACHE_CLEANUP_LIBRARY_ID,
  CACHE_CLEANUP_LIBRARY_VERSION,
  buildCacheCleanupEnvelope,
  classifyCacheCleanup,
  compareCacheCleanup,
  createCacheCleanupLibrary
} from '../pc/engines/cache-cleanup/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    caches: [
      { name: 'system-cache', sizeBytes: 100, safe: true, systemOwned: true, userOwned: false },
      { name: 'app-cache', sizeBytes: 200, safe: false, systemOwned: false, userOwned: true }
    ],
    ...overrides
  };
}

describe('Cache-cleanup library', () => {
  test('classifies safe candidates, ownership review, and bounded totals', () => {
    expect(classifyCacheCleanup(facts())).toMatchObject({
      library: CACHE_CLEANUP_LIBRARY_ID,
      libraryVersion: CACHE_CLEANUP_LIBRARY_VERSION,
      environment: 'interactive',
      cacheCount: 2,
      names: ['system-cache', 'app-cache'],
      safeCandidateCount: 1,
      safeCandidateBytes: 100,
      reviewCount: 1,
      completeCount: 2,
      state: 'review-required',
      confidence: 1,
      recommendations: ['review-cache-ownership']
    });
    expect(classifyCacheCleanup(facts({ caches: [
      { name: 'safe-cache', sizeBytes: 50, safe: true, systemOwned: true }
    ] }))).toMatchObject({
      safeCandidateCount: 1, safeCandidateBytes: 50, reviewCount: 0,
      state: 'preview-only', recommendations: ['preview-safe-cache-candidates']
    });
  });

  test('preserves empty, unknown, user-owned, and incomplete states', () => {
    expect(classifyCacheCleanup(facts({ environment: 'other', caches: [] }))).toMatchObject({
      environment: 'unknown', cacheCount: 0, state: 'profile-required', confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(classifyCacheCleanup(facts({ environment: 'headless', caches: [] }))).toMatchObject({
      state: 'no-caches', confidence: 0.25, recommendations: ['no-cache-cleanup-review']
    });
    expect(classifyCacheCleanup(facts({ caches: [
      { name: 'user-cache', sizeBytes: 10, safe: true, systemOwned: true, userOwned: true },
      { name: 'unknown-cache', sizeBytes: 20, safe: true, systemOwned: false },
      { name: 'incomplete-cache', sizeBytes: -1, safe: true, systemOwned: true }
    ] }))).toMatchObject({
      safeCandidateCount: 1, safeCandidateBytes: 0, reviewCount: 2,
      completeCount: 2, state: 'review-required', confidence: 0.5
    });
    expect(classifyCacheCleanup(facts({ caches: [null, {}] }))).toMatchObject({
      cacheCount: 1, names: [], safeCandidateCount: 0, safeCandidateBytes: 0,
      reviewCount: 1, completeCount: 0, confidence: 0.5
    });
  });

  test('compares snapshots and builds immutable local facades', () => {
    expect(compareCacheCleanup(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, countChanged: false,
      candidateCountChanged: false, candidateBytesChanged: false, reviewChanged: false
    });
    expect(compareCacheCleanup(facts(), facts({ caches: [
      { name: 'safe-cache', sizeBytes: 101, safe: true, systemOwned: true }
    ] }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: true,
      candidateCountChanged: false, candidateBytesChanged: true, reviewChanged: true
    });
    expect(compareCacheCleanup(facts(), facts({ caches: [] }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: true,
      candidateCountChanged: true, candidateBytesChanged: true, reviewChanged: true
    });
    expect(compareCacheCleanup(facts({ caches: [
      { name: 'safe-cache', sizeBytes: 100, safe: true, systemOwned: true }
    ] }), facts({ caches: [
      { name: 'safe-cache', sizeBytes: 200, safe: true, systemOwned: true }
    ] }))).toMatchObject({
      changed: true, stateChanged: false, countChanged: false,
      candidateCountChanged: false, candidateBytesChanged: true, reviewChanged: false
    });
    const envelope = buildCacheCleanupEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createCacheCleanupLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyCacheCleanup(null)).toThrow('facts must be an object');
    expect(() => classifyCacheCleanup({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyCacheCleanup({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyCacheCleanup({ ...facts(), caches: null }))
      .toThrow('requires a cache list');
    expect(() => buildCacheCleanupEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildCacheCleanupEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildCacheCleanupEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildCacheCleanupEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createCacheCleanupLibrary(null)).toThrow('options must be an object');
    expect(() => createCacheCleanupLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
