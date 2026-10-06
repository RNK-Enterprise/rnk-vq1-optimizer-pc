import {
  CACHE_SIZE_TREND_TRIGGERS,
  CACHE_SIZE_TREND_TURBO_ID,
  CACHE_SIZE_TREND_TURBO_VERSION,
  runCacheSizeTrendTurbo
} from '../pc/engines/cache-cleanup/turbos/size-trend/turbo.js';

function cache(sizeBytes) {
  return { sizeBytes };
}

function facts(caches = [], overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', caches, ...overrides };
}

describe('cache-cleanup size-trend turbo', () => {
  test('publishes identity and detects sustained size growth', () => {
    expect(CACHE_SIZE_TREND_TURBO_ID).toBe('cache-cleanup.size-trend');
    expect(CACHE_SIZE_TREND_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(CACHE_SIZE_TREND_TRIGGERS)).toBe(true);
    const result = runCacheSizeTrendTurbo([
      facts([cache(10)]), facts([cache(20)]), facts([cache(30)])
    ], { trigger: 'system.facts.request', minimumDeltaBytes: 5, now: () => 0 });
    expect(result).toMatchObject({
      turbo: CACHE_SIZE_TREND_TURBO_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      sampleCount: 3,
      cacheCount: 1,
      knownCount: 1,
      invalidSizeCount: 0,
      totalBytes: 30,
      comparisonCount: 2,
      changeCount: 2,
      increaseCount: 2,
      decreaseCount: 0,
      deltaBytes: 10,
      finalEnvironment: 'interactive',
      state: 'size-drift-sustained',
      confidence: 1,
      recommendations: ['review-cache-size-trend-without-file-mutation'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes stable, observed, invalid, empty, and insufficient states', () => {
    expect(runCacheSizeTrendTurbo([facts([cache(10)]), facts([cache(10)])], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'stable-size', changeCount: 0 });
    expect(runCacheSizeTrendTurbo([facts([cache(20)]), facts([cache(10)])], {
      trigger: 'workload.changed', persistenceThreshold: 2, minimumDeltaBytes: 5, now: () => 0
    })).toMatchObject({ state: 'size-drift-observed', decreaseCount: 1, deltaBytes: -10 });
    expect(runCacheSizeTrendTurbo([facts([cache(5), cache('bad')]), facts([cache(5), cache(-1)])], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'invalid-size-evidence', invalidSizeCount: 1 });
    expect(runCacheSizeTrendTurbo([facts([]), facts([])], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'no-size-observation', knownCount: 0, confidence: 0 });
    expect(runCacheSizeTrendTurbo([], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });

  test('normalizes non-record rows and unknown environments', () => {
    expect(runCacheSizeTrendTurbo([facts([null, cache(5)], { environment: 'other' })], {
      trigger: 'health.interval', minimumSamples: 1, now: () => 0
    })).toMatchObject({ finalEnvironment: 'unknown', cacheCount: 1, knownCount: 1,
      totalBytes: 5, state: 'stable-size' });
  });

  test('rejects invalid triggers, bounds, lists, thresholds, and clocks', () => {
    expect(() => runCacheSizeTrendTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported cache-cleanup size-trend trigger: bad');
    expect(() => runCacheSizeTrendTurbo()).toThrow('Unsupported cache-cleanup size-trend trigger: unknown');
    expect(() => runCacheSizeTrendTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCacheSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCacheSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCacheSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runCacheSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runCacheSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runCacheSizeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runCacheSizeTrendTurbo([], { trigger: 'health.interval', minimumDeltaBytes: -1 }))
      .toThrow('minimumDeltaBytes must be a safe non-negative number');
    expect(() => runCacheSizeTrendTurbo([], { trigger: 'health.interval', minimumDeltaBytes: Number.MAX_SAFE_INTEGER + 1 }))
      .toThrow('minimumDeltaBytes must be a safe non-negative number');
    expect(() => runCacheSizeTrendTurbo([null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runCacheSizeTrendTurbo([{ engine: 'other' }], { trigger: 'health.interval' }))
      .toThrow('requires a system-facts snapshot');
    expect(() => runCacheSizeTrendTurbo([{ engine: 'system-facts', caches: null }], {
      trigger: 'health.interval'
    })).toThrow('requires a cache list');
    expect(() => runCacheSizeTrendTurbo([], { trigger: 'health.interval', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
