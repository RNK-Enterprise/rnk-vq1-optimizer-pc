import {
  STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_ID,
  STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_VERSION,
  buildStorageCapacityFreeSpaceDriftEnvelope,
  buildStorageCapacityFreeSpaceDriftPlan,
  createStorageCapacityFreeSpaceDriftLibrary,
  mergeStorageCapacityFreeSpaceDriftReports
} from '../pc/engines/storage-capacity/turbos/free-space-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'storage-capacity.free-space-drift', state: 'stable-headroom', sampleCount,
    minimumSamples: 2, headroomThreshold: 20, persistenceThreshold: 2, storageCount: 2,
    minimumFreePercent: 60, observedCount: sampleCount, incompleteCount: 0, noStorageCount: 0,
    pressureSampleCount: 0, confidence: 1, ...overrides };
}

describe('storage-capacity free-space-drift library', () => {
  test('publishes identity and merges headroom evidence', () => {
    const merged = mergeStorageCapacityFreeSpaceDriftReports([
      report({ sampleCount: 2, minimumFreePercent: 15, pressureSampleCount: 1 }),
      report({ state: 'headroom-pressure-sustained', sampleCount: 6, observedCount: 5,
        minimumFreePercent: 10, pressureSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_ID).toBe('storage-capacity.free-space-drift.library');
    expect(STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'headroom-pressure-sustained', sampleCount: 8,
      minimumFreePercent: 10, pressureSampleCount: 4, confidence: 0.875,
      recommendations: ['review-free-space', 'hold-automatic-cleanup'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeStorageCapacityFreeSpaceDriftReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeStorageCapacityFreeSpaceDriftReports([report({ state: 'no-storage', sampleCount: 1,
      storageCount: 0, minimumFreePercent: null, observedCount: 0, noStorageCount: 1, confidence: 0 })]))
      .toMatchObject({ state: 'no-storage', recommendations: ['no-storage-headroom-review'] });
    expect(mergeStorageCapacityFreeSpaceDriftReports([report({ state: 'incomplete-headroom-evidence',
      minimumFreePercent: null, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-headroom-evidence', recommendations: ['request-headroom-observation']
    });
    expect(mergeStorageCapacityFreeSpaceDriftReports([report({ state: 'headroom-pressure-observed',
      minimumFreePercent: 15, pressureSampleCount: 1 })]).recommendations)
      .toEqual(['observe-next-headroom-sample']);
    expect(mergeStorageCapacityFreeSpaceDriftReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeStorageCapacityFreeSpaceDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      storageCount: 0, minimumFreePercent: null, observedCount: 0, confidence: 0 })]).state)
      .toBe('insufficient-data');
    expect(mergeStorageCapacityFreeSpaceDriftReports([report({ state: 'insufficient-data', sampleCount: 0,
      storageCount: 0, minimumFreePercent: null, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeStorageCapacityFreeSpaceDriftReports([
      report({ state: 'headroom-pressure-sustained' }), report({ state: 'no-storage', sampleCount: 1,
        storageCount: 0, minimumFreePercent: null, observedCount: 0, noStorageCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-storage' });
    const states = [['headroom-pressure-sustained', 'headroom-pressure-review', 750],
      ['headroom-pressure-observed', 'headroom-pressure-observation', 1000],
      ['stable-headroom', 'stable-headroom-observation', 5000], ['no-storage', 'no-storage-observation', 10000],
      ['incomplete-headroom-evidence', 'evidence-bootstrap', 1500], ['insufficient-data', 'sample-bootstrap', 1500]];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-storage'; const sampleCount = empty ? 1 : 4; const confidence = empty ? 0 : 1;
      expect(buildStorageCapacityFreeSpaceDriftPlan(report({ state, sampleCount,
        storageCount: empty ? 0 : 2, minimumFreePercent: empty ? null : 60,
        observedCount: empty ? 0 : sampleCount, noStorageCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildStorageCapacityFreeSpaceDriftPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildStorageCapacityFreeSpaceDriftPlan(report({ sampleCount: 0, storageCount: 0,
      minimumFreePercent: null, observedCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildStorageCapacityFreeSpaceDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createStorageCapacityFreeSpaceDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, storageCount: 0, minimumFreePercent: null, observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeStorageCapacityFreeSpaceDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeStorageCapacityFreeSpaceDriftReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeStorageCapacityFreeSpaceDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeStorageCapacityFreeSpaceDriftReports([report({ turbo: 'other' })])).toThrow('requires a free-space-drift turbo report');
    expect(() => mergeStorageCapacityFreeSpaceDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeStorageCapacityFreeSpaceDriftReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeStorageCapacityFreeSpaceDriftReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeStorageCapacityFreeSpaceDriftReports([report({ headroomThreshold: 101 })])).toThrow('headroomThreshold must be between 0 and 100');
    expect(() => mergeStorageCapacityFreeSpaceDriftReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noStorageCount', 'pressureSampleCount']) {
      expect(() => mergeStorageCapacityFreeSpaceDriftReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergeStorageCapacityFreeSpaceDriftReports([report({ storageCount: 4097 })])).toThrow('storageCount must be from 0 to 4096');
    expect(() => mergeStorageCapacityFreeSpaceDriftReports([report({ minimumFreePercent: 101 })])).toThrow('minimumFreePercent must be null or from 0 to 100');
    expect(() => mergeStorageCapacityFreeSpaceDriftReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildStorageCapacityFreeSpaceDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildStorageCapacityFreeSpaceDriftEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
