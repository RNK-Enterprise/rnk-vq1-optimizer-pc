import {
  TEMP_CLEANUP_ENGINE_ID,
  TEMP_CLEANUP_ENGINE_VERSION,
  TEMP_CLEANUP_TRIGGERS,
  runTempCleanupEngine
} from '../pc/engines/temp-cleanup/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    temporaryFiles: [
      { name: 'system-temp', sizeBytes: 100, temporary: true, systemOwned: true, userOwned: false },
      { name: 'user-temp', sizeBytes: 200, temporary: true, systemOwned: false, userOwned: true }
    ],
    ...overrides
  };
}

describe('Temp-cleanup engine', () => {
  test('publishes identity and triggers', () => {
    expect(TEMP_CLEANUP_ENGINE_ID).toBe('temp-cleanup');
    expect(TEMP_CLEANUP_ENGINE_VERSION).toBe(1);
    expect(TEMP_CLEANUP_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(TEMP_CLEANUP_TRIGGERS)).toBe(true);
  });

  test('previews only explicit temporary system-owned candidates', () => {
    const result = runTempCleanupEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: TEMP_CLEANUP_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      temporaryFileCount: 2,
      names: ['system-temp', 'user-temp'],
      safeCandidateCount: 1,
      safeCandidateBytes: 100,
      reviewCount: 1,
      completeCount: 2,
      state: 'review-required',
      confidence: 1,
      recommendations: ['review-temp-file-ownership'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('keeps user-owned and ambiguous temporary files out of candidates', () => {
    expect(runTempCleanupEngine(facts({ temporaryFiles: [
      { name: 'user', sizeBytes: 10, temporary: true, systemOwned: true, userOwned: true },
      { name: 'unknown', sizeBytes: 20, temporary: true, systemOwned: false, userOwned: false },
      { name: 'unmarked', sizeBytes: 30 }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      safeCandidateCount: 0,
      safeCandidateBytes: 0,
      reviewCount: 3,
      state: 'review-required',
      recommendations: ['review-temp-file-ownership']
    });
  });

  test('reports empty, incomplete, and malformed temporary-file facts', () => {
    expect(runTempCleanupEngine(facts({ temporaryFiles: [{}] }), {
      trigger: 'health.interval',
      now: () => 0
    })).toMatchObject({
      temporaryFileCount: 1,
      names: [],
      safeCandidateCount: 0,
      safeCandidateBytes: 0,
      reviewCount: 1,
      completeCount: 0,
      confidence: 0.5,
      state: 'review-required'
    });
    expect(runTempCleanupEngine(facts({ temporaryFiles: [null, {
      name: '', sizeBytes: -1, temporary: true, systemOwned: true, userOwned: false
    }] }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      temporaryFileCount: 1,
      safeCandidateCount: 1,
      safeCandidateBytes: 0,
      completeCount: 0
    });
    expect(runTempCleanupEngine(facts({
      environment: 'headless',
      temporaryFiles: []
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      temporaryFileCount: 0,
      state: 'no-temp-review',
      confidence: 0.25,
      recommendations: ['no-temp-cleanup-review']
    });
  });

  test('requires a known environment, facts, temporary-file list, triggers, and clock', () => {
    expect(runTempCleanupEngine(facts({
      environment: 'other',
      temporaryFiles: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(() => runTempCleanupEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runTempCleanupEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runTempCleanupEngine(facts({ temporaryFiles: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a temporary-file list');
    expect(() => runTempCleanupEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported temp-cleanup trigger: bad');
    expect(() => runTempCleanupEngine(facts(), {}))
      .toThrow('Unsupported temp-cleanup trigger: unknown');
    expect(() => runTempCleanupEngine())
      .toThrow('Unsupported temp-cleanup trigger: unknown');
    expect(() => runTempCleanupEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Temp-cleanup clock must return a number');
  });
});
