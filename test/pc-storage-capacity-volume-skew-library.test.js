import {
  STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_ID,
  STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_VERSION,
  buildStorageCapacityVolumeSkewEnvelope,
  buildStorageCapacityVolumeSkewPlan,
  createStorageCapacityVolumeSkewLibrary,
  mergeStorageCapacityVolumeSkewReports
} from '../pc/engines/storage-capacity/turbos/volume-skew/library.js';

function report(overrides = {}) { const sampleCount = overrides.sampleCount ?? 4; return {
  turbo: 'storage-capacity.volume-skew', state: 'balanced-volumes', sampleCount, minimumSamples: 2,
  skewThreshold: 30, persistenceThreshold: 2, storageCount: 2, skewPercent: 10,
  observedCount: sampleCount, incompleteCount: 0, noStorageCount: 0, skewSampleCount: 0, confidence: 1, ...overrides
}; }

describe('storage-capacity volume-skew library', () => {
  test('publishes identity and merges skew evidence', () => {
    const merged = mergeStorageCapacityVolumeSkewReports([
      report({ sampleCount: 2, skewPercent: 40, skewSampleCount: 1 }),
      report({ state: 'volume-skew-sustained', sampleCount: 6, observedCount: 5, skewPercent: 70, skewSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_ID).toBe('storage-capacity.volume-skew.library');
    expect(STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'volume-skew-sustained', sampleCount: 8, skewPercent: 70, skewSampleCount: 4, confidence: 0.875, recommendations: ['review-volume-headroom', 'hold-automatic-rebalancing'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('preserves aggregate states and empty confidence', () => {
    expect(mergeStorageCapacityVolumeSkewReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeStorageCapacityVolumeSkewReports([report({ state: 'no-storage', sampleCount: 1, storageCount: 0, skewPercent: null, observedCount: 0, noStorageCount: 1, confidence: 0 })])).toMatchObject({ state: 'no-storage', recommendations: ['no-storage-skew-review'] });
    expect(mergeStorageCapacityVolumeSkewReports([report({ state: 'incomplete-skew-evidence', skewPercent: null, incompleteCount: 1, confidence: 0 })])).toMatchObject({ state: 'incomplete-skew-evidence', recommendations: ['request-volume-observation'] });
    expect(mergeStorageCapacityVolumeSkewReports([report({ state: 'volume-skew-observed', skewPercent: 40, skewSampleCount: 1 })]).recommendations).toEqual(['observe-volume-headroom']);
    expect(mergeStorageCapacityVolumeSkewReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeStorageCapacityVolumeSkewReports([report({ state: 'insufficient-data', sampleCount: 1, storageCount: 0, skewPercent: null, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeStorageCapacityVolumeSkewReports([report({ state: 'insufficient-data', sampleCount: 0, storageCount: 0, skewPercent: null, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });
  test('applies safety precedence and builds every state plan', () => {
    expect(mergeStorageCapacityVolumeSkewReports([report({ state: 'volume-skew-sustained' }), report({ state: 'no-storage', sampleCount: 1, storageCount: 0, skewPercent: null, observedCount: 0, noStorageCount: 1, confidence: 0 })])).toMatchObject({ state: 'no-storage' });
    const states = [['volume-skew-sustained', 'volume-skew-review', 750], ['volume-skew-observed', 'volume-skew-observation', 1000], ['balanced-volumes', 'balanced-volume-observation', 5000], ['no-storage', 'no-storage-observation', 10000], ['incomplete-skew-evidence', 'evidence-bootstrap', 1500], ['insufficient-data', 'sample-bootstrap', 1500]];
    for (const [state, mode, intervalMs] of states) { const empty = state === 'no-storage'; const sampleCount = empty ? 1 : 4; const confidence = empty ? 0 : 1; expect(buildStorageCapacityVolumeSkewPlan(report({ state, sampleCount, storageCount: empty ? 0 : 2, skewPercent: empty ? null : 10, observedCount: empty ? 0 : sampleCount, noStorageCount: empty ? 1 : 0, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence }); }
    expect(buildStorageCapacityVolumeSkewPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildStorageCapacityVolumeSkewPlan(report({ sampleCount: 0, storageCount: 0, skewPercent: null, observedCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds immutable envelopes and factories', () => {
    const envelope = buildStorageCapacityVolumeSkewEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_ID, libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true); const library = createStorageCapacityVolumeSkewLibrary();
    expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, storageCount: 0, skewPercent: null, observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeStorageCapacityVolumeSkewReports(null)).toThrow('reports must be an array');
    expect(() => mergeStorageCapacityVolumeSkewReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeStorageCapacityVolumeSkewReports([null])).toThrow('report must be an object');
    expect(() => mergeStorageCapacityVolumeSkewReports([report({ turbo: 'other' })])).toThrow('requires a volume-skew turbo report');
    expect(() => mergeStorageCapacityVolumeSkewReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeStorageCapacityVolumeSkewReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeStorageCapacityVolumeSkewReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeStorageCapacityVolumeSkewReports([report({ skewThreshold: 101 })])).toThrow('skewThreshold must be between 0 and 100');
    expect(() => mergeStorageCapacityVolumeSkewReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noStorageCount', 'skewSampleCount']) expect(() => mergeStorageCapacityVolumeSkewReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    expect(() => mergeStorageCapacityVolumeSkewReports([report({ storageCount: 4097 })])).toThrow('storageCount must be from 0 to 4096');
    expect(() => mergeStorageCapacityVolumeSkewReports([report({ skewPercent: 101 })])).toThrow('skewPercent must be null or from 0 to 100');
    expect(() => mergeStorageCapacityVolumeSkewReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildStorageCapacityVolumeSkewEnvelope(report())).toThrow('trigger is required');
    expect(() => buildStorageCapacityVolumeSkewEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
