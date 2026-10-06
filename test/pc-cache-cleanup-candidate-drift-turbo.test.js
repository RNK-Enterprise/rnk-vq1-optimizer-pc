import {
  CACHE_CANDIDATE_DRIFT_TRIGGERS,
  CACHE_CANDIDATE_DRIFT_TURBO_ID,
  CACHE_CANDIDATE_DRIFT_TURBO_VERSION,
  runCacheCandidateDriftTurbo
} from '../pc/engines/cache-cleanup/turbos/candidate-drift/turbo.js';

function cache(name, sizeBytes, overrides = {}) {
  return { name, sizeBytes, safe: true, systemOwned: true, ...overrides };
}

function facts(caches = [], overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', caches, ...overrides };
}

describe('cache-cleanup candidate-drift turbo', () => {
  test('publishes identity and detects sustained safe-candidate drift', () => {
    expect(CACHE_CANDIDATE_DRIFT_TURBO_ID).toBe('cache-cleanup.candidate-drift');
    expect(CACHE_CANDIDATE_DRIFT_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(CACHE_CANDIDATE_DRIFT_TRIGGERS)).toBe(true);
    const result = runCacheCandidateDriftTurbo([
      facts([cache('shader', 10)]), facts([cache('temp', 20)]), facts([cache('index', 30)])
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({
      turbo: CACHE_CANDIDATE_DRIFT_TURBO_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      sampleCount: 3,
      candidateCount: 1,
      namedCandidateCount: 1,
      candidateBytes: 30,
      reviewCount: 0,
      comparisonCount: 2,
      changeCount: 2,
      addedCount: 2,
      removedCount: 2,
      sizeChangeCount: 0,
      finalEnvironment: 'interactive',
      state: 'candidate-drift-sustained',
      confidence: 1,
      recommendations: ['review-candidate-drift-without-file-mutation'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes stable, observed, review, empty, and insufficient states', () => {
    expect(runCacheCandidateDriftTurbo([facts([cache('x', 1)]), facts([cache('x', 1)])], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'stable-preview', changeCount: 0 });
    expect(runCacheCandidateDriftTurbo([facts([cache('x', 1)]), facts([cache('x', 2)])], {
      trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0
    })).toMatchObject({ state: 'candidate-drift-observed', sizeChangeCount: 1 });
    expect(runCacheCandidateDriftTurbo([facts([cache('x', 1, { userOwned: true })]), facts([cache('x', 1)])], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'review-required', reviewCount: 1 });
    expect(runCacheCandidateDriftTurbo([facts([]), facts([])], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'no-candidates', candidateCount: 0, confidence: 0.5 });
    expect(runCacheCandidateDriftTurbo([], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });

  test('keeps incomplete rows in review and normalizes unknown environments', () => {
    const result = runCacheCandidateDriftTurbo([facts([
      null, cache('', 4), cache('unnumbered', 'bad')
    ], { environment: 'other' })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 });
    expect(result).toMatchObject({ finalEnvironment: 'unknown', candidateCount: 1,
      namedCandidateCount: 0, candidateBytes: 0, reviewCount: 1, state: 'review-required', confidence: 1 });
    expect(runCacheCandidateDriftTurbo([facts([null])], {
      trigger: 'workload.changed', minimumSamples: 1, now: () => 0
    })).toMatchObject({ candidateCount: 0, state: 'no-candidates' });
  });

  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runCacheCandidateDriftTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported cache-cleanup candidate-drift trigger: bad');
    expect(() => runCacheCandidateDriftTurbo()).toThrow('Unsupported cache-cleanup candidate-drift trigger: unknown');
    expect(() => runCacheCandidateDriftTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCacheCandidateDriftTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCacheCandidateDriftTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCacheCandidateDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runCacheCandidateDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runCacheCandidateDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runCacheCandidateDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runCacheCandidateDriftTurbo([null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runCacheCandidateDriftTurbo([{ engine: 'other' }], { trigger: 'health.interval' }))
      .toThrow('requires a system-facts snapshot');
    expect(() => runCacheCandidateDriftTurbo([{ engine: 'system-facts', caches: null }], {
      trigger: 'health.interval'
    })).toThrow('requires a cache list');
    expect(() => runCacheCandidateDriftTurbo([], { trigger: 'health.interval', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
