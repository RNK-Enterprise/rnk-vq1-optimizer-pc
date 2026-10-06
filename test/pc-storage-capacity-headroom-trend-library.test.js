import {
  STORAGE_CAPACITY_HEADROOM_TREND_LIBRARY_ID,
  STORAGE_CAPACITY_HEADROOM_TREND_LIBRARY_VERSION,
  buildStorageCapacityHeadroomTrendEnvelope,
  buildStorageCapacityHeadroomTrendPlan,
  createStorageCapacityHeadroomTrendLibrary,
  mergeStorageCapacityHeadroomTrendReports
} from '../pc/engines/storage-capacity/turbos/headroom-trend/library.js';

function report(overrides = {}) { const sampleCount = overrides.sampleCount ?? 4; return { turbo: 'storage-capacity.headroom-trend', state: 'stable-headroom-trend', sampleCount, minimumSamples: 2, declineThreshold: 5, persistenceThreshold: 2, storageCount: 1, minimumFreePercent: 60, observedCount: sampleCount, incompleteCount: 0, noStorageCount: 0, declineSampleCount: 0, confidence: 1, ...overrides }; }

describe('storage-capacity headroom-trend library', () => {
  test('publishes identity and merges trend evidence', () => {
    const merged = mergeStorageCapacityHeadroomTrendReports([report({ sampleCount: 2, minimumFreePercent: 70, declineSampleCount: 1 }), report({ state: 'headroom-decline-sustained', sampleCount: 6, observedCount: 5, minimumFreePercent: 60, declineSampleCount: 3, confidence: 0.8333 })]);
    expect(STORAGE_CAPACITY_HEADROOM_TREND_LIBRARY_ID).toBe('storage-capacity.headroom-trend.library');
    expect(STORAGE_CAPACITY_HEADROOM_TREND_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'headroom-decline-sustained', sampleCount: 8, minimumFreePercent: 60, declineSampleCount: 4, confidence: 0.875, recommendations: ['review-capacity-trend', 'hold-automatic-cleanup'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('preserves aggregate states and empty confidence', () => {
    expect(mergeStorageCapacityHeadroomTrendReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeStorageCapacityHeadroomTrendReports([report({ state: 'no-storage', sampleCount: 1, storageCount: 0, minimumFreePercent: null, observedCount: 0, noStorageCount: 1, confidence: 0 })])).toMatchObject({ state: 'no-storage', recommendations: ['no-storage-trend-review'] });
    expect(mergeStorageCapacityHeadroomTrendReports([report({ state: 'incomplete-trend-evidence', minimumFreePercent: null, incompleteCount: 1, confidence: 0 })])).toMatchObject({ state: 'incomplete-trend-evidence', recommendations: ['request-headroom-observation'] });
    expect(mergeStorageCapacityHeadroomTrendReports([report({ state: 'headroom-decline-observed', minimumFreePercent: 55, declineSampleCount: 1 })]).recommendations).toEqual(['observe-next-headroom-trend']);
    expect(mergeStorageCapacityHeadroomTrendReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeStorageCapacityHeadroomTrendReports([report({ state: 'insufficient-data', sampleCount: 1, storageCount: 0, minimumFreePercent: null, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeStorageCapacityHeadroomTrendReports([report({ state: 'insufficient-data', sampleCount: 0, storageCount: 0, minimumFreePercent: null, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });
  test('applies safety precedence and builds every state plan', () => {
    expect(mergeStorageCapacityHeadroomTrendReports([report({ state: 'headroom-decline-sustained' }), report({ state: 'no-storage', sampleCount: 1, storageCount: 0, minimumFreePercent: null, observedCount: 0, noStorageCount: 1, confidence: 0 })])).toMatchObject({ state: 'no-storage' });
    const states = [['headroom-decline-sustained', 'headroom-trend-review', 750], ['headroom-decline-observed', 'headroom-trend-observation', 1000], ['stable-headroom-trend', 'stable-headroom-observation', 5000], ['no-storage', 'no-storage-observation', 10000], ['incomplete-trend-evidence', 'evidence-bootstrap', 1500], ['insufficient-data', 'sample-bootstrap', 1500]];
    for (const [state, mode, intervalMs] of states) { const empty = state === 'no-storage'; const sampleCount = empty ? 1 : 4; const confidence = empty ? 0 : 1; expect(buildStorageCapacityHeadroomTrendPlan(report({ state, sampleCount, storageCount: empty ? 0 : 1, minimumFreePercent: empty ? null : 60, observedCount: empty ? 0 : sampleCount, noStorageCount: empty ? 1 : 0, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence }); }
    expect(buildStorageCapacityHeadroomTrendPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildStorageCapacityHeadroomTrendPlan(report({ sampleCount: 0, storageCount: 0, minimumFreePercent: null, observedCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds immutable envelopes and factories', () => {
    const envelope = buildStorageCapacityHeadroomTrendEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: STORAGE_CAPACITY_HEADROOM_TREND_LIBRARY_ID, libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true); const library = createStorageCapacityHeadroomTrendLibrary();
    expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(STORAGE_CAPACITY_HEADROOM_TREND_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, storageCount: 0, minimumFreePercent: null, observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeStorageCapacityHeadroomTrendReports(null)).toThrow('reports must be an array');
    expect(() => mergeStorageCapacityHeadroomTrendReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeStorageCapacityHeadroomTrendReports([null])).toThrow('report must be an object');
    expect(() => mergeStorageCapacityHeadroomTrendReports([report({ turbo: 'other' })])).toThrow('requires a headroom-trend turbo report');
    expect(() => mergeStorageCapacityHeadroomTrendReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeStorageCapacityHeadroomTrendReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeStorageCapacityHeadroomTrendReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeStorageCapacityHeadroomTrendReports([report({ declineThreshold: 101 })])).toThrow('declineThreshold must be between 0 and 100');
    expect(() => mergeStorageCapacityHeadroomTrendReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noStorageCount', 'declineSampleCount']) expect(() => mergeStorageCapacityHeadroomTrendReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    expect(() => mergeStorageCapacityHeadroomTrendReports([report({ storageCount: 4097 })])).toThrow('storageCount must be from 0 to 4096');
    expect(() => mergeStorageCapacityHeadroomTrendReports([report({ minimumFreePercent: 101 })])).toThrow('minimumFreePercent must be null or from 0 to 100');
    expect(() => mergeStorageCapacityHeadroomTrendReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildStorageCapacityHeadroomTrendEnvelope(report())).toThrow('trigger is required');
    expect(() => buildStorageCapacityHeadroomTrendEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
