import {
  STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_ID,
  STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_VERSION,
  buildStorageHealthHealthDegradationEnvelope,
  buildStorageHealthHealthDegradationPlan,
  createStorageHealthHealthDegradationLibrary,
  mergeStorageHealthHealthDegradationReports
} from '../pc/engines/storage-health/turbos/health-degradation/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'storage-health.health-degradation', state: 'healthy-storage', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, storageCount: 2,
    failedCount: 0, degradedCount: 0, unknownCount: 0, observedCount: sampleCount,
    incompleteCount: 0, noStorageCount: 0, failureSampleCount: 0,
    degradationSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('storage-health health-degradation library', () => {
  test('publishes identity and merges health evidence', () => {
    const merged = mergeStorageHealthHealthDegradationReports([
      report({ sampleCount: 2, failedCount: 1, failureSampleCount: 1, degradationSampleCount: 1 }),
      report({ state: 'health-failure-sustained', sampleCount: 6, observedCount: 5,
        failedCount: 1, failureSampleCount: 3, degradationSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_ID).toBe('storage-health.health-degradation.library');
    expect(STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'health-failure-sustained', sampleCount: 8,
      failedCount: 1, failureSampleCount: 4, degradationSampleCount: 4, confidence: 0.875,
      recommendations: ['protect-data', 'request-user-approved-storage-review'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeStorageHealthHealthDegradationReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeStorageHealthHealthDegradationReports([report({ state: 'no-storage', sampleCount: 1,
      storageCount: 0, observedCount: 0, noStorageCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-storage', recommendations: ['no-storage-health-review']
    });
    expect(mergeStorageHealthHealthDegradationReports([report({ state: 'incomplete-health-evidence',
      unknownCount: 1, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-health-evidence', recommendations: ['request-health-observation']
    });
    expect(mergeStorageHealthHealthDegradationReports([report({ state: 'health-degradation-observed',
      degradedCount: 1, degradationSampleCount: 1 })]).recommendations)
      .toEqual(['observe-storage-health']);
    expect(mergeStorageHealthHealthDegradationReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeStorageHealthHealthDegradationReports([report({ state: 'insufficient-data', sampleCount: 1,
      storageCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeStorageHealthHealthDegradationReports([report({ state: 'insufficient-data', sampleCount: 0,
      storageCount: 0, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeStorageHealthHealthDegradationReports([
      report({ state: 'health-failure-sustained' }), report({ state: 'no-storage', sampleCount: 1,
        storageCount: 0, observedCount: 0, noStorageCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-storage' });
    const states = [
      ['health-failure-sustained', 'storage-failure-review', 750],
      ['health-degradation-observed', 'storage-health-observation', 1000],
      ['healthy-storage', 'healthy-storage-observation', 5000],
      ['no-storage', 'no-storage-observation', 10000],
      ['incomplete-health-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-storage';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildStorageHealthHealthDegradationPlan(report({ state, sampleCount,
        storageCount: empty ? 0 : 2, failedCount: 0, degradedCount: 0, unknownCount: 0,
        observedCount: empty ? 0 : sampleCount, noStorageCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildStorageHealthHealthDegradationPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildStorageHealthHealthDegradationPlan(report({ sampleCount: 0, storageCount: 0,
      observedCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildStorageHealthHealthDegradationEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createStorageHealthHealthDegradationLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, storageCount: 0,
      observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeStorageHealthHealthDegradationReports(null)).toThrow('reports must be an array');
    expect(() => mergeStorageHealthHealthDegradationReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeStorageHealthHealthDegradationReports([null])).toThrow('report must be an object');
    expect(() => mergeStorageHealthHealthDegradationReports([report({ turbo: 'other' })]))
      .toThrow('requires a health-degradation turbo report');
    expect(() => mergeStorageHealthHealthDegradationReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeStorageHealthHealthDegradationReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeStorageHealthHealthDegradationReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeStorageHealthHealthDegradationReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noStorageCount',
      'failureSampleCount', 'degradationSampleCount']) {
      expect(() => mergeStorageHealthHealthDegradationReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['failedCount', 'degradedCount', 'unknownCount']) {
      expect(() => mergeStorageHealthHealthDegradationReports([report({ [field]: 3 })]))
        .toThrow('must fit inside storageCount');
    }
    expect(() => mergeStorageHealthHealthDegradationReports([report({ storageCount: 4097 })]))
      .toThrow('storageCount must be from 0 to 4096');
    expect(() => mergeStorageHealthHealthDegradationReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildStorageHealthHealthDegradationEnvelope(report())).toThrow('trigger is required');
    expect(() => buildStorageHealthHealthDegradationEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
