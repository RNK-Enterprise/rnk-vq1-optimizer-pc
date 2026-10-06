import {
  CACHE_EVIDENCE_TRIGGERS,
  CACHE_EVIDENCE_TURBO_ID,
  CACHE_EVIDENCE_TURBO_VERSION,
  runCacheEvidenceCompletenessTurbo
} from '../pc/engines/cache-cleanup/turbos/evidence-completeness/turbo.js';

function complete(name = 'cache') {
  return { name, sizeBytes: 10, systemOwned: true, userOwned: false, safe: true };
}

function incomplete(overrides = {}) {
  return { name: 'cache', sizeBytes: 10, systemOwned: true, userOwned: false, safe: true, ...overrides };
}

function facts(caches = [], overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', caches, ...overrides };
}

describe('cache-cleanup evidence-completeness turbo', () => {
  test('publishes identity and detects sustained evidence drift', () => {
    expect(CACHE_EVIDENCE_TURBO_ID).toBe('cache-cleanup.evidence-completeness');
    expect(CACHE_EVIDENCE_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(CACHE_EVIDENCE_TRIGGERS)).toBe(true);
    const result = runCacheEvidenceCompletenessTurbo([
      facts([incomplete({ name: '' })]), facts([complete(), incomplete({ safe: false })]),
      facts([incomplete({ sizeBytes: 'bad' })]), facts([complete()])
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({
      turbo: CACHE_EVIDENCE_TURBO_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      sampleCount: 4,
      cacheCount: 1,
      completeCount: 1,
      incompleteCount: 0,
      completeness: 1,
      comparisonCount: 3,
      changeCount: 3,
      completenessChangeCount: 3,
      incompleteChangeCount: 3,
      finalEnvironment: 'interactive',
      state: 'evidence-drift-sustained',
      confidence: 1,
      recommendations: ['review-cache-evidence-drift'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes complete, observed, incomplete, empty, and insufficient states', () => {
    expect(runCacheEvidenceCompletenessTurbo([facts([complete()]), facts([complete()])], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'complete-evidence', completeness: 1, changeCount: 0 });
    expect(runCacheEvidenceCompletenessTurbo([facts([incomplete({ name: '' })]), facts([complete()])], {
      trigger: 'health.interval', persistenceThreshold: 2, now: () => 0
    })).toMatchObject({ state: 'evidence-drift-observed', changeCount: 1 });
    expect(runCacheEvidenceCompletenessTurbo([facts([incomplete({ safe: false })]), facts([incomplete({ sizeBytes: -1 })])], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'incomplete-evidence', completeness: 0, incompleteCount: 1 });
    expect(runCacheEvidenceCompletenessTurbo([facts([]), facts([])], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'no-cache-evidence', cacheCount: 0, completeness: 0, confidence: 0 });
    expect(runCacheEvidenceCompletenessTurbo([], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });

  test('checks every metadata field and normalizes unknown environments', () => {
    const result = runCacheEvidenceCompletenessTurbo([facts([
      incomplete({ name: '' }), incomplete({ sizeBytes: 'bad' }),
      incomplete({ systemOwned: 'yes' }), incomplete({ userOwned: 'no' }), incomplete({ safe: 'yes' })
    ], { environment: 'other' })], { trigger: 'install.preflight', minimumSamples: 1, now: () => 0 });
    expect(result).toMatchObject({ finalEnvironment: 'unknown', cacheCount: 5,
      completeCount: 0, incompleteCount: 5, state: 'incomplete-evidence' });
    expect(runCacheEvidenceCompletenessTurbo([facts([complete()])], {
      trigger: 'health.interval', minimumSamples: 1, minimumCompleteness: 0.5, now: () => 0
    })).toMatchObject({ completeness: 1, state: 'complete-evidence' });
  });

  test('rejects invalid triggers, bounds, ratios, snapshots, lists, and clocks', () => {
    expect(() => runCacheEvidenceCompletenessTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported cache-cleanup evidence-completeness trigger: bad');
    expect(() => runCacheEvidenceCompletenessTurbo()).toThrow('Unsupported cache-cleanup evidence-completeness trigger: unknown');
    expect(() => runCacheEvidenceCompletenessTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCacheEvidenceCompletenessTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCacheEvidenceCompletenessTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCacheEvidenceCompletenessTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runCacheEvidenceCompletenessTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runCacheEvidenceCompletenessTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runCacheEvidenceCompletenessTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runCacheEvidenceCompletenessTurbo([], { trigger: 'health.interval', minimumCompleteness: -0.1 }))
      .toThrow('minimumCompleteness must be between 0 and 1');
    expect(() => runCacheEvidenceCompletenessTurbo([], { trigger: 'health.interval', minimumCompleteness: 1.1 }))
      .toThrow('minimumCompleteness must be between 0 and 1');
    expect(() => runCacheEvidenceCompletenessTurbo([null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runCacheEvidenceCompletenessTurbo([{ engine: 'other' }], { trigger: 'health.interval' }))
      .toThrow('requires a system-facts snapshot');
    expect(() => runCacheEvidenceCompletenessTurbo([{ engine: 'system-facts', caches: null }], {
      trigger: 'health.interval'
    })).toThrow('requires a cache list');
    expect(() => runCacheEvidenceCompletenessTurbo([], { trigger: 'health.interval', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
