import { TEMP_OWNERSHIP_DRIFT_LIBRARY_ID, TEMP_OWNERSHIP_DRIFT_LIBRARY_VERSION,
  buildTempOwnershipDriftEnvelope, buildTempOwnershipDriftPlan, createTempOwnershipDriftLibrary,
  mergeTempOwnershipDriftReports } from '../pc/engines/temp-cleanup/turbos/ownership-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'temp-cleanup.ownership-drift', state: 'stable-ownership', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    fileCount: 1, systemOwnedCount: 1, userOwnedCount: 0, unknownOwnershipCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changeCount: 0,
    finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('temp-cleanup ownership-drift library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeTempOwnershipDriftReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'ownership-drift-sustained', changeCount: 2, finalEnvironment: 'headless' })]);
    expect(TEMP_OWNERSHIP_DRIFT_LIBRARY_ID).toBe('temp-cleanup.ownership-drift.library'); expect(TEMP_OWNERSHIP_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'ownership-drift-sustained', sampleCount: 6, fileCount: 1, systemOwnedCount: 1, comparisonCount: 4, changeCount: 2, finalEnvironment: 'headless', recommendations: ['review-temp-ownership-drift-without-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeTempOwnershipDriftReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-temp-ownership-samples'] });
    expect(mergeTempOwnershipDriftReports([report({ state: 'no-temp-review', fileCount: 0, systemOwnedCount: 0, comparisonCount: 0, confidence: 0.25 })]).recommendations).toEqual(['no-temp-cleanup-review']);
    expect(mergeTempOwnershipDriftReports([report({ state: 'user-owned-review', userOwnedCount: 1, systemOwnedCount: 0 })]).recommendations).toEqual(['preserve-user-owned-temp-boundary']);
    expect(mergeTempOwnershipDriftReports([report({ state: 'ownership-required', unknownOwnershipCount: 1, systemOwnedCount: 0 })]).recommendations).toEqual(['request-temp-file-ownership']);
    expect(mergeTempOwnershipDriftReports([report({ state: 'ownership-drift-observed', changeCount: 1 })]).recommendations).toEqual(['observe-temp-ownership-stability']);
    expect(mergeTempOwnershipDriftReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeTempOwnershipDriftReports([report({ state: 'insufficient-data', sampleCount: 1, fileCount: 0, systemOwnedCount: 0, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, sampleCount, fileCount, confidence] of [['no-temp-review', 'empty-observation', 10000, 4, 0, 0.25], ['user-owned-review', 'user-boundary', 750, 4, 1, 1], ['ownership-required', 'ownership-bootstrap', 2000, 4, 1, 0.5], ['ownership-drift-sustained', 'ownership-review', 1000, 4, 1, 1], ['ownership-drift-observed', 'ownership-observation', 1500, 4, 1, 1], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0, 0], ['stable-ownership', 'stable-observation', 5000, 4, 1, 1]]) {
      expect(buildTempOwnershipDriftPlan(report({ state, sampleCount, fileCount, systemOwnedCount: state === 'user-owned-review' ? 0 : fileCount, userOwnedCount: state === 'user-owned-review' ? 1 : 0, unknownOwnershipCount: state === 'ownership-required' ? 1 : 0, comparisonCount: Math.max(0, sampleCount - 1), confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildTempOwnershipDriftPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildTempOwnershipDriftPlan(report({ sampleCount: 0, fileCount: 0, systemOwnedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildTempOwnershipDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createTempOwnershipDriftLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(TEMP_OWNERSHIP_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeTempOwnershipDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeTempOwnershipDriftReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeTempOwnershipDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeTempOwnershipDriftReports([report({ turbo: 'other' })])).toThrow('requires an ownership-drift turbo report');
    expect(() => mergeTempOwnershipDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeTempOwnershipDriftReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeTempOwnershipDriftReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeTempOwnershipDriftReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeTempOwnershipDriftReports([report({ fileCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeTempOwnershipDriftReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeTempOwnershipDriftReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildTempOwnershipDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildTempOwnershipDriftEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
