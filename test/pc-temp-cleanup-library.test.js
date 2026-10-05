import {
  TEMP_CLEANUP_LIBRARY_ID,
  TEMP_CLEANUP_LIBRARY_VERSION,
  buildTempCleanupEnvelope,
  classifyTempCleanup,
  compareTempCleanup,
  createTempCleanupLibrary
} from '../pc/engines/temp-cleanup/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    temporaryFiles: [
      { name: 'system-temp', sizeBytes: 100, temporary: true, systemOwned: true, userOwned: false },
      { name: 'user-temp', sizeBytes: 200, temporary: true, systemOwned: false, userOwned: true }
    ],
    ...overrides
  };
}

describe('Temp-cleanup library', () => {
  test('classifies safe candidates, ownership review, and bounded totals', () => {
    expect(classifyTempCleanup(facts())).toMatchObject({
      library: TEMP_CLEANUP_LIBRARY_ID,
      libraryVersion: TEMP_CLEANUP_LIBRARY_VERSION,
      environment: 'interactive',
      temporaryFileCount: 2,
      names: ['system-temp', 'user-temp'],
      safeCandidateCount: 1,
      safeCandidateBytes: 100,
      reviewCount: 1,
      completeCount: 2,
      state: 'review-required',
      confidence: 1,
      recommendations: ['review-temp-file-ownership']
    });
    expect(classifyTempCleanup(facts({ temporaryFiles: [
      { name: 'safe-temp', sizeBytes: 50, temporary: true, systemOwned: true }
    ] }))).toMatchObject({
      safeCandidateCount: 1, safeCandidateBytes: 50, reviewCount: 0,
      state: 'preview-only', recommendations: ['preview-safe-temp-candidates']
    });
  });

  test('preserves empty, unknown, user-owned, and incomplete states', () => {
    expect(classifyTempCleanup(facts({ environment: 'other', temporaryFiles: [] }))).toMatchObject({
      environment: 'unknown', temporaryFileCount: 0, state: 'profile-required', confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(classifyTempCleanup(facts({ environment: 'headless', temporaryFiles: [] }))).toMatchObject({
      state: 'no-temp-review', confidence: 0.25, recommendations: ['no-temp-cleanup-review']
    });
    expect(classifyTempCleanup(facts({ temporaryFiles: [
      { name: 'user-temp', sizeBytes: 10, temporary: true, systemOwned: true, userOwned: true },
      { name: 'unknown-temp', sizeBytes: 20, temporary: true, systemOwned: false },
      { name: 'incomplete-temp', sizeBytes: -1, temporary: true, systemOwned: true }
    ] }))).toMatchObject({
      safeCandidateCount: 1, safeCandidateBytes: 0, reviewCount: 2,
      completeCount: 2, state: 'review-required', confidence: 0.5
    });
    expect(classifyTempCleanup(facts({ temporaryFiles: [null, {}] }))).toMatchObject({
      temporaryFileCount: 1, names: [], safeCandidateCount: 0, safeCandidateBytes: 0,
      reviewCount: 1, completeCount: 0, confidence: 0.5
    });
  });

  test('compares snapshots and builds immutable local facades', () => {
    expect(compareTempCleanup(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, countChanged: false,
      candidateCountChanged: false, candidateBytesChanged: false, reviewChanged: false
    });
    expect(compareTempCleanup(facts(), facts({ temporaryFiles: [
      { name: 'safe-temp', sizeBytes: 101, temporary: true, systemOwned: true }
    ] }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: true,
      candidateCountChanged: false, candidateBytesChanged: true, reviewChanged: true
    });
    expect(compareTempCleanup(facts(), facts({ temporaryFiles: [] }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: true,
      candidateCountChanged: true, candidateBytesChanged: true, reviewChanged: true
    });
    expect(compareTempCleanup(facts({ temporaryFiles: [
      { name: 'safe-temp', sizeBytes: 100, temporary: true, systemOwned: true }
    ] }), facts({ temporaryFiles: [
      { name: 'safe-temp', sizeBytes: 200, temporary: true, systemOwned: true }
    ] }))).toMatchObject({
      changed: true, stateChanged: false, countChanged: false,
      candidateCountChanged: false, candidateBytesChanged: true, reviewChanged: false
    });
    const envelope = buildTempCleanupEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createTempCleanupLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyTempCleanup(null)).toThrow('facts must be an object');
    expect(() => classifyTempCleanup({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyTempCleanup({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyTempCleanup({ ...facts(), temporaryFiles: null }))
      .toThrow('requires a temporary-file list');
    expect(() => buildTempCleanupEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildTempCleanupEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildTempCleanupEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildTempCleanupEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createTempCleanupLibrary(null)).toThrow('options must be an object');
    expect(() => createTempCleanupLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
