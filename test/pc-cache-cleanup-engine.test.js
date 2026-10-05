import {
  CACHE_CLEANUP_ENGINE_ID,
  CACHE_CLEANUP_ENGINE_VERSION,
  CACHE_CLEANUP_TRIGGERS,
  runCacheCleanupEngine
} from '../pc/engines/cache-cleanup/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    caches: [
      { name: 'system-cache', sizeBytes: 100, safe: true, systemOwned: true, userOwned: false },
      { name: 'app-cache', sizeBytes: 200, safe: false, systemOwned: false, userOwned: true }
    ],
    ...overrides
  };
}

describe('Cache-cleanup engine', () => {
  test('publishes identity and triggers', () => {
    expect(CACHE_CLEANUP_ENGINE_ID).toBe('cache-cleanup');
    expect(CACHE_CLEANUP_ENGINE_VERSION).toBe(1);
    expect(CACHE_CLEANUP_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(CACHE_CLEANUP_TRIGGERS)).toBe(true);
  });

  test('previews only explicitly safe system-owned caches', () => {
    const result = runCacheCleanupEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: CACHE_CLEANUP_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      cacheCount: 2,
      names: ['system-cache', 'app-cache'],
      safeCandidateCount: 1,
      safeCandidateBytes: 100,
      reviewCount: 1,
      completeCount: 2,
      state: 'review-required',
      confidence: 1,
      recommendations: ['review-cache-ownership'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('keeps ambiguous and user-owned caches out of candidates', () => {
    expect(runCacheCleanupEngine(facts({ caches: [
      { name: 'user-cache', sizeBytes: 10, safe: true, systemOwned: true, userOwned: true },
      { name: 'unknown-cache', sizeBytes: 20, safe: true, systemOwned: false, userOwned: false },
      { name: 'unmarked-cache', sizeBytes: 30 }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      safeCandidateCount: 0,
      safeCandidateBytes: 0,
      reviewCount: 3,
      state: 'review-required',
      recommendations: ['review-cache-ownership']
    });
  });

  test('reports empty, incomplete, and malformed cache facts', () => {
    expect(runCacheCleanupEngine(facts({ caches: [{}] }), {
      trigger: 'health.interval',
      now: () => 0
    })).toMatchObject({
      cacheCount: 1,
      names: [],
      safeCandidateCount: 0,
      safeCandidateBytes: 0,
      reviewCount: 1,
      completeCount: 0,
      confidence: 0.5,
      state: 'review-required'
    });
    expect(runCacheCleanupEngine(facts({ caches: [null, {
      name: '', sizeBytes: -1, safe: true, systemOwned: true, userOwned: false
    }] }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      cacheCount: 1,
      safeCandidateCount: 1,
      safeCandidateBytes: 0,
      completeCount: 0
    });
    expect(runCacheCleanupEngine(facts({
      environment: 'headless',
      caches: []
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      cacheCount: 0,
      state: 'no-caches',
      confidence: 0.25,
      recommendations: ['no-cache-cleanup-review']
    });
  });

  test('requires a known environment, facts, cache list, triggers, and clock', () => {
    expect(runCacheCleanupEngine(facts({
      environment: 'other',
      caches: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(() => runCacheCleanupEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runCacheCleanupEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runCacheCleanupEngine(facts({ caches: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a cache list');
    expect(() => runCacheCleanupEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported cache-cleanup trigger: bad');
    expect(() => runCacheCleanupEngine(facts(), {}))
      .toThrow('Unsupported cache-cleanup trigger: unknown');
    expect(() => runCacheCleanupEngine())
      .toThrow('Unsupported cache-cleanup trigger: unknown');
    expect(() => runCacheCleanupEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Cache-cleanup clock must return a number');
  });
});
