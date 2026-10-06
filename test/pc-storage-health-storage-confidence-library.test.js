import {
  STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_ID,
  STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_VERSION,
  buildStorageHealthStorageConfidenceEnvelope,
  buildStorageHealthStorageConfidencePlan,
  createStorageHealthStorageConfidenceLibrary,
  mergeStorageHealthStorageConfidenceReports
} from '../pc/engines/storage-health/turbos/storage-confidence/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'storage-health.storage-confidence', state: 'complete-storage-observation', sampleCount,
    minimumSamples: 2, completenessThreshold: 0.75, persistenceThreshold: 2,
    storageCount: 2, completeCount: 2, incompleteRowCount: 0, completenessRatio: 1,
    observedCount: sampleCount, incompleteCount: 0, noStorageCount: 0,
    lowConfidenceSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('storage-health storage-confidence library', () => {
  test('publishes identity and merges completeness evidence', () => {
    const merged = mergeStorageHealthStorageConfidenceReports([
      report({ sampleCount: 2, completeCount: 1, incompleteRowCount: 1,
        completenessRatio: 0.5, lowConfidenceSampleCount: 1 }),
      report({ state: 'low-confidence-sustained', sampleCount: 6, observedCount: 5,
        completeCount: 1, incompleteRowCount: 1, completenessRatio: 0.5,
        lowConfidenceSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_ID).toBe('storage-health.storage-confidence.library');
    expect(STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'low-confidence-sustained', sampleCount: 8,
      completeCount: 1, incompleteRowCount: 1, completenessRatio: 0.5,
      lowConfidenceSampleCount: 4, confidence: 0.875,
      recommendations: ['request-complete-storage-facts'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeStorageHealthStorageConfidenceReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeStorageHealthStorageConfidenceReports([report({ state: 'no-storage', sampleCount: 1,
      storageCount: 0, completeCount: 0, incompleteRowCount: 0, completenessRatio: null,
      observedCount: 0, noStorageCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-storage', recommendations: ['no-storage-confidence-review']
    });
    expect(mergeStorageHealthStorageConfidenceReports([report({ state: 'incomplete-confidence-evidence',
      storageCount: 2, completeCount: 0, incompleteRowCount: 2, completenessRatio: null,
      incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-confidence-evidence', recommendations: ['request-environment-profile']
    });
    expect(mergeStorageHealthStorageConfidenceReports([report({ state: 'low-confidence-observed',
      completeCount: 1, incompleteRowCount: 1, completenessRatio: 0.5,
      lowConfidenceSampleCount: 1 })]).recommendations)
      .toEqual(['observe-storage-fact-completeness']);
    expect(mergeStorageHealthStorageConfidenceReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeStorageHealthStorageConfidenceReports([report({ state: 'insufficient-data', sampleCount: 1,
      storageCount: 0, completeCount: 0, incompleteRowCount: 0, completenessRatio: null,
      observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeStorageHealthStorageConfidenceReports([report({ state: 'insufficient-data', sampleCount: 0,
      storageCount: 0, completeCount: 0, incompleteRowCount: 0, completenessRatio: null,
      observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeStorageHealthStorageConfidenceReports([
      report({ state: 'low-confidence-sustained' }), report({ state: 'no-storage', sampleCount: 1,
        storageCount: 0, completeCount: 0, incompleteRowCount: 0, completenessRatio: null,
        observedCount: 0, noStorageCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-storage' });
    const states = [
      ['low-confidence-sustained', 'storage-fact-review', 750],
      ['low-confidence-observed', 'storage-fact-observation', 1000],
      ['complete-storage-observation', 'complete-storage-observation', 5000],
      ['no-storage', 'no-storage-observation', 10000],
      ['incomplete-confidence-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-storage';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildStorageHealthStorageConfidencePlan(report({ state, sampleCount,
        storageCount: empty ? 0 : 2, completeCount: empty ? 0 : 2,
        incompleteRowCount: 0, completenessRatio: empty ? null : 1,
        observedCount: empty ? 0 : sampleCount, noStorageCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildStorageHealthStorageConfidencePlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildStorageHealthStorageConfidencePlan(report({ sampleCount: 0, storageCount: 0,
      completeCount: 0, incompleteRowCount: 0, completenessRatio: null,
      observedCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildStorageHealthStorageConfidenceEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createStorageHealthStorageConfidenceLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, storageCount: 0,
      completeCount: 0, incompleteRowCount: 0, completenessRatio: null,
      observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, ratios, triggers, and clocks', () => {
    expect(() => mergeStorageHealthStorageConfidenceReports(null)).toThrow('reports must be an array');
    expect(() => mergeStorageHealthStorageConfidenceReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeStorageHealthStorageConfidenceReports([null])).toThrow('report must be an object');
    expect(() => mergeStorageHealthStorageConfidenceReports([report({ turbo: 'other' })]))
      .toThrow('requires a storage-confidence turbo report');
    expect(() => mergeStorageHealthStorageConfidenceReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeStorageHealthStorageConfidenceReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeStorageHealthStorageConfidenceReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeStorageHealthStorageConfidenceReports([report({ completenessThreshold: 1.1 })]))
      .toThrow('completenessThreshold must be between 0 and 1');
    expect(() => mergeStorageHealthStorageConfidenceReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noStorageCount', 'lowConfidenceSampleCount']) {
      expect(() => mergeStorageHealthStorageConfidenceReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeStorageHealthStorageConfidenceReports([report({ storageCount: 4097 })]))
      .toThrow('storageCount must be from 0 to 4096');
    expect(() => mergeStorageHealthStorageConfidenceReports([report({ completeCount: 3 })]))
      .toThrow('completeCount must fit inside storageCount');
    expect(() => mergeStorageHealthStorageConfidenceReports([report({ incompleteRowCount: 3 })]))
      .toThrow('incompleteRowCount must fit inside storageCount');
    expect(() => mergeStorageHealthStorageConfidenceReports([report({ completenessRatio: 1.1 })]))
      .toThrow('completenessRatio must be null or between 0 and 1');
    expect(() => mergeStorageHealthStorageConfidenceReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildStorageHealthStorageConfidenceEnvelope(report())).toThrow('trigger is required');
    expect(() => buildStorageHealthStorageConfidenceEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
