import {
  STORAGE_HEALTH_CAPACITY_DRIFT_LIBRARY_ID,
  STORAGE_HEALTH_CAPACITY_DRIFT_LIBRARY_VERSION,
  buildStorageHealthCapacityDriftEnvelope,
  buildStorageHealthCapacityDriftPlan,
  createStorageHealthCapacityDriftLibrary,
  mergeStorageHealthCapacityDriftReports
} from '../pc/engines/storage-health/turbos/capacity-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'storage-health.capacity-drift', state: 'stable-capacity', sampleCount,
    minimumSamples: 2, capacityThreshold: 90, persistenceThreshold: 2,
    storageCount: 2, maximumUsedPercent: 60, observedCount: sampleCount,
    incompleteCount: 0, noStorageCount: 0, pressureSampleCount: 0,
    confidence: 1, ...overrides
  };
}

describe('storage-health capacity-drift library', () => {
  test('publishes identity and merges capacity evidence', () => {
    const merged = mergeStorageHealthCapacityDriftReports([
      report({ sampleCount: 2, maximumUsedPercent: 94, pressureSampleCount: 1 }),
      report({ state: 'capacity-pressure-sustained', sampleCount: 6, observedCount: 5,
        maximumUsedPercent: 96, pressureSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(STORAGE_HEALTH_CAPACITY_DRIFT_LIBRARY_ID).toBe('storage-health.capacity-drift.library');
    expect(STORAGE_HEALTH_CAPACITY_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'capacity-pressure-sustained', sampleCount: 8,
      maximumUsedPercent: 96, pressureSampleCount: 4, confidence: 0.875,
      recommendations: ['review-free-space', 'hold-automatic-cleanup'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeStorageHealthCapacityDriftReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeStorageHealthCapacityDriftReports([report({ state: 'no-storage', sampleCount: 1,
      storageCount: 0, maximumUsedPercent: null, observedCount: 0, noStorageCount: 1, confidence: 0 })]))
      .toMatchObject({ state: 'no-storage', recommendations: ['no-storage-capacity-review'] });
    expect(mergeStorageHealthCapacityDriftReports([report({ state: 'incomplete-capacity-evidence',
      maximumUsedPercent: null, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-capacity-evidence', recommendations: ['request-capacity-observation']
    });
    expect(mergeStorageHealthCapacityDriftReports([report({ state: 'capacity-pressure-observed',
      maximumUsedPercent: 95, pressureSampleCount: 1 })]).recommendations)
      .toEqual(['observe-next-capacity-sample']);
    expect(mergeStorageHealthCapacityDriftReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeStorageHealthCapacityDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      storageCount: 0, maximumUsedPercent: null, observedCount: 0, confidence: 0 })]).state)
      .toBe('insufficient-data');
    expect(mergeStorageHealthCapacityDriftReports([report({ state: 'insufficient-data', sampleCount: 0,
      storageCount: 0, maximumUsedPercent: null, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeStorageHealthCapacityDriftReports([
      report({ state: 'capacity-pressure-sustained' }), report({ state: 'no-storage', sampleCount: 1,
        storageCount: 0, maximumUsedPercent: null, observedCount: 0, noStorageCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-storage' });
    const states = [
      ['capacity-pressure-sustained', 'capacity-pressure-review', 750],
      ['capacity-pressure-observed', 'capacity-pressure-observation', 1000],
      ['stable-capacity', 'stable-capacity-observation', 5000],
      ['no-storage', 'no-storage-observation', 10000],
      ['incomplete-capacity-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-storage';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildStorageHealthCapacityDriftPlan(report({ state, sampleCount,
        storageCount: empty ? 0 : 2, maximumUsedPercent: empty ? null : 60,
        observedCount: empty ? 0 : sampleCount, noStorageCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildStorageHealthCapacityDriftPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildStorageHealthCapacityDriftPlan(report({ sampleCount: 0, storageCount: 0,
      maximumUsedPercent: null, observedCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildStorageHealthCapacityDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: STORAGE_HEALTH_CAPACITY_DRIFT_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createStorageHealthCapacityDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(STORAGE_HEALTH_CAPACITY_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, storageCount: 0,
      maximumUsedPercent: null, observedCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeStorageHealthCapacityDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeStorageHealthCapacityDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeStorageHealthCapacityDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeStorageHealthCapacityDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a capacity-drift turbo report');
    expect(() => mergeStorageHealthCapacityDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeStorageHealthCapacityDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeStorageHealthCapacityDriftReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeStorageHealthCapacityDriftReports([report({ capacityThreshold: 101 })]))
      .toThrow('capacityThreshold must be between 0 and 100');
    expect(() => mergeStorageHealthCapacityDriftReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noStorageCount', 'pressureSampleCount']) {
      expect(() => mergeStorageHealthCapacityDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeStorageHealthCapacityDriftReports([report({ storageCount: 4097 })]))
      .toThrow('storageCount must be from 0 to 4096');
    expect(() => mergeStorageHealthCapacityDriftReports([report({ maximumUsedPercent: 101 })]))
      .toThrow('maximumUsedPercent must be null or from 0 to 100');
    expect(() => mergeStorageHealthCapacityDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildStorageHealthCapacityDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildStorageHealthCapacityDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
