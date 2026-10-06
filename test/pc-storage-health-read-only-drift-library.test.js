import {
  STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_ID,
  STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_VERSION,
  buildStorageHealthReadOnlyDriftEnvelope,
  buildStorageHealthReadOnlyDriftPlan,
  createStorageHealthReadOnlyDriftLibrary,
  mergeStorageHealthReadOnlyDriftReports
} from '../pc/engines/storage-health/turbos/read-only-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'storage-health.read-only-drift', state: 'stable-read-only', sampleCount,
    minimumSamples: 2, readOnlyThreshold: 0.5, persistenceThreshold: 2,
    storageCount: 2, readOnlyCount: 0, readOnlyRatio: 0, observedCount: sampleCount,
    incompleteCount: 0, noStorageCount: 0, elevatedSampleCount: 0,
    confidence: 1, ...overrides
  };
}

describe('storage-health read-only-drift library', () => {
  test('publishes identity and merges read-only evidence', () => {
    const merged = mergeStorageHealthReadOnlyDriftReports([
      report({ sampleCount: 2, readOnlyCount: 1, readOnlyRatio: 0.5, elevatedSampleCount: 1 }),
      report({ state: 'read-only-increase-sustained', sampleCount: 6, observedCount: 5,
        readOnlyCount: 2, readOnlyRatio: 1, elevatedSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_ID).toBe('storage-health.read-only-drift.library');
    expect(STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'read-only-increase-sustained', sampleCount: 8,
      readOnlyCount: 2, readOnlyRatio: 1, elevatedSampleCount: 4, confidence: 0.875,
      recommendations: ['review-mount-state', 'hold-remount-policy'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeStorageHealthReadOnlyDriftReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeStorageHealthReadOnlyDriftReports([report({ state: 'no-storage', sampleCount: 1,
      storageCount: 0, readOnlyCount: 0, readOnlyRatio: null, observedCount: 0,
      noStorageCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-storage', recommendations: ['no-storage-read-only-review']
    });
    expect(mergeStorageHealthReadOnlyDriftReports([report({ state: 'incomplete-read-only-evidence',
      storageCount: 0, readOnlyCount: 0, readOnlyRatio: null, incompleteCount: 1, confidence: 0 })])
      .recommendations).toEqual(['request-read-only-observation']);
    expect(mergeStorageHealthReadOnlyDriftReports([report({ state: 'read-only-observed',
      readOnlyCount: 1, readOnlyRatio: 0.5, elevatedSampleCount: 1 })]).recommendations)
      .toEqual(['observe-read-only-state']);
    expect(mergeStorageHealthReadOnlyDriftReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeStorageHealthReadOnlyDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      storageCount: 0, readOnlyCount: 0, readOnlyRatio: null, observedCount: 0, confidence: 0 })]).state)
      .toBe('insufficient-data');
    expect(mergeStorageHealthReadOnlyDriftReports([report({ state: 'insufficient-data', sampleCount: 0,
      storageCount: 0, readOnlyCount: 0, readOnlyRatio: null, observedCount: 0, confidence: 0 })]).confidence)
      .toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeStorageHealthReadOnlyDriftReports([
      report({ state: 'read-only-increase-sustained' }), report({ state: 'no-storage', sampleCount: 1,
        storageCount: 0, readOnlyCount: 0, readOnlyRatio: null, observedCount: 0,
        noStorageCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-storage' });
    const states = [
      ['read-only-increase-sustained', 'read-only-mount-review', 750],
      ['read-only-observed', 'read-only-observation', 1000],
      ['stable-read-only', 'stable-read-only-observation', 5000],
      ['no-storage', 'no-storage-observation', 10000],
      ['incomplete-read-only-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-storage';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildStorageHealthReadOnlyDriftPlan(report({ state, sampleCount,
        storageCount: empty ? 0 : 2, readOnlyCount: 0, readOnlyRatio: empty ? null : 0,
        observedCount: empty ? 0 : sampleCount, noStorageCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildStorageHealthReadOnlyDriftPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildStorageHealthReadOnlyDriftPlan(report({ sampleCount: 0, storageCount: 0,
      readOnlyCount: 0, readOnlyRatio: null, observedCount: 0, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildStorageHealthReadOnlyDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createStorageHealthReadOnlyDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, storageCount: 0,
      readOnlyCount: 0, readOnlyRatio: null, observedCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, ratios, triggers, and clocks', () => {
    expect(() => mergeStorageHealthReadOnlyDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeStorageHealthReadOnlyDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeStorageHealthReadOnlyDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeStorageHealthReadOnlyDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a read-only-drift turbo report');
    expect(() => mergeStorageHealthReadOnlyDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeStorageHealthReadOnlyDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeStorageHealthReadOnlyDriftReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeStorageHealthReadOnlyDriftReports([report({ readOnlyThreshold: 1.1 })]))
      .toThrow('readOnlyThreshold must be between 0 and 1');
    expect(() => mergeStorageHealthReadOnlyDriftReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noStorageCount', 'elevatedSampleCount']) {
      expect(() => mergeStorageHealthReadOnlyDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeStorageHealthReadOnlyDriftReports([report({ storageCount: 4097 })]))
      .toThrow('storageCount must be from 0 to 4096');
    expect(() => mergeStorageHealthReadOnlyDriftReports([report({ readOnlyCount: 3 })]))
      .toThrow('readOnlyCount must fit inside storageCount');
    expect(() => mergeStorageHealthReadOnlyDriftReports([report({ readOnlyRatio: 1.1 })]))
      .toThrow('readOnlyRatio must be null or between 0 and 1');
    expect(() => mergeStorageHealthReadOnlyDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildStorageHealthReadOnlyDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildStorageHealthReadOnlyDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
