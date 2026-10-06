import {
  CACHE_OWNERSHIP_TRIGGERS,
  CACHE_OWNERSHIP_TURBO_ID,
  CACHE_OWNERSHIP_TURBO_VERSION,
  runCacheOwnershipBoundaryTurbo
} from '../pc/engines/cache-cleanup/turbos/ownership-boundary/turbo.js';

function cache(name, overrides = {}) {
  return { name, safe: true, systemOwned: true, ...overrides };
}

function facts(caches = [], overrides = {}) {
  return { engine: 'system-facts', environment: 'headless', caches, ...overrides };
}

describe('cache-cleanup ownership-boundary turbo', () => {
  test('publishes identity and detects sustained ownership drift', () => {
    expect(CACHE_OWNERSHIP_TURBO_ID).toBe('cache-cleanup.ownership-boundary');
    expect(CACHE_OWNERSHIP_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(CACHE_OWNERSHIP_TRIGGERS)).toBe(true);
    const result = runCacheOwnershipBoundaryTurbo([
      facts([cache('a')]), facts([cache('a'), cache('b')]), facts([cache('a'), cache('b'), cache('c')])
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({
      turbo: CACHE_OWNERSHIP_TURBO_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      sampleCount: 3,
      cacheCount: 3,
      userOwnedCount: 0,
      systemSafeCount: 3,
      ambiguousCount: 0,
      knownCount: 3,
      comparisonCount: 2,
      changeCount: 2,
      userOwnedChangeCount: 0,
      systemSafeChangeCount: 2,
      ambiguousChangeCount: 0,
      finalEnvironment: 'headless',
      state: 'ownership-drift-sustained',
      confidence: 0.75,
      recommendations: ['review-ownership-drift-without-file-mutation'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes stable, observed, user-owned, ambiguous, empty, and insufficient states', () => {
    expect(runCacheOwnershipBoundaryTurbo([facts([cache('a')]), facts([cache('a')])], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'stable-ownership', changeCount: 0 });
    expect(runCacheOwnershipBoundaryTurbo([facts([cache('a')]), facts([cache('a', { safe: false })])], {
      trigger: 'health.interval', persistenceThreshold: 2, now: () => 0
    })).toMatchObject({ state: 'ambiguous-review', ambiguousCount: 1 });
    expect(runCacheOwnershipBoundaryTurbo([facts([cache('a')]), facts([cache('a'), cache('b')])], {
      trigger: 'health.interval', persistenceThreshold: 2, now: () => 0
    })).toMatchObject({ state: 'ownership-drift-observed', changeCount: 1 });
    expect(runCacheOwnershipBoundaryTurbo([facts([cache('a', { userOwned: true })])], {
      trigger: 'health.interval', minimumSamples: 1, now: () => 0
    })).toMatchObject({ state: 'user-owned-present', userOwnedCount: 1 });
    expect(runCacheOwnershipBoundaryTurbo([facts([]), facts([])], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'stable-ownership', cacheCount: 0, knownCount: 0, confidence: 0 });
    expect(runCacheOwnershipBoundaryTurbo([], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });

  test('keeps non-record rows out and normalizes unknown environments', () => {
    const result = runCacheOwnershipBoundaryTurbo([facts([
      null, cache('ambiguous', { safe: false }), cache('user', { userOwned: true })
    ], { environment: 'other' })], { trigger: 'install.preflight', minimumSamples: 1, now: () => 0 });
    expect(result).toMatchObject({ finalEnvironment: 'unknown', cacheCount: 2,
      userOwnedCount: 1, ambiguousCount: 1, state: 'user-owned-present' });
  });

  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runCacheOwnershipBoundaryTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported cache-cleanup ownership-boundary trigger: bad');
    expect(() => runCacheOwnershipBoundaryTurbo()).toThrow('Unsupported cache-cleanup ownership-boundary trigger: unknown');
    expect(() => runCacheOwnershipBoundaryTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCacheOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCacheOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCacheOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runCacheOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runCacheOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runCacheOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runCacheOwnershipBoundaryTurbo([null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runCacheOwnershipBoundaryTurbo([{ engine: 'other' }], { trigger: 'health.interval' }))
      .toThrow('requires a system-facts snapshot');
    expect(() => runCacheOwnershipBoundaryTurbo([{ engine: 'system-facts', caches: null }], {
      trigger: 'health.interval'
    })).toThrow('requires a cache list');
    expect(() => runCacheOwnershipBoundaryTurbo([], { trigger: 'health.interval', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
