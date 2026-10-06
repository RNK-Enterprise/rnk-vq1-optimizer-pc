import { STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_ID, STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_VERSION,
  buildStartupOwnershipBoundaryEnvelope, buildStartupOwnershipBoundaryPlan, createStartupOwnershipBoundaryLibrary,
  mergeStartupOwnershipBoundaryReports } from '../pc/engines/startup/turbos/ownership-boundary/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'startup.ownership-boundary', state: 'stable-ownership', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    entryCount: 1, userOwnedCount: 0, systemOwnedCount: 1, unknownOwnershipCount: 0, userOwnedEnabledCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changeCount: 0,
    finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('startup ownership-boundary library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeStartupOwnershipBoundaryReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'ownership-drift-sustained', changeCount: 2, finalEnvironment: 'headless' })]);
    expect(STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_ID).toBe('startup.ownership-boundary.library'); expect(STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'ownership-drift-sustained', sampleCount: 6, entryCount: 1, userOwnedCount: 0, systemOwnedCount: 1, unknownOwnershipCount: 0, comparisonCount: 4, changeCount: 2, finalEnvironment: 'headless', recommendations: ['review-startup-ownership-drift-without-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeStartupOwnershipBoundaryReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-startup-ownership-samples'] });
    expect(mergeStartupOwnershipBoundaryReports([report({ state: 'no-startup-items', entryCount: 0, systemOwnedCount: 0, confidence: 0.25 })]).recommendations).toEqual(['no-startup-review']);
    expect(mergeStartupOwnershipBoundaryReports([report({ state: 'ownership-required', unknownOwnershipCount: 1, confidence: 0.5 })]).recommendations).toEqual(['request-startup-ownership']);
    expect(mergeStartupOwnershipBoundaryReports([report({ state: 'user-owned-review', userOwnedCount: 1, userOwnedEnabledCount: 1 })]).recommendations).toEqual(['preserve-user-owned-startup-boundary']);
    expect(mergeStartupOwnershipBoundaryReports([report({ state: 'ownership-drift-observed', changeCount: 1 })]).recommendations).toEqual(['observe-startup-ownership-stability']);
    expect(mergeStartupOwnershipBoundaryReports([report({ state: 'insufficient-data', sampleCount: 1, entryCount: 0, systemOwnedCount: 0, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeStartupOwnershipBoundaryReports([report()])).toMatchObject({ state: 'stable-ownership', recommendations: ['no-change'] });
    for (const [state, mode, intervalMs, sampleCount, confidence] of [['no-startup-items', 'empty-observation', 10000, 4, 0.25], ['ownership-required', 'ownership-evidence-review', 750, 4, 0.5], ['user-owned-review', 'user-owned-review', 1000, 4, 1], ['ownership-drift-sustained', 'ownership-drift-review', 1250, 4, 1], ['ownership-drift-observed', 'ownership-drift-observation', 1500, 4, 1], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0], ['stable-ownership', 'stable-observation', 5000, 4, 1]]) {
      expect(buildStartupOwnershipBoundaryPlan(report({ state, sampleCount, entryCount: state === 'no-startup-items' || state === 'insufficient-data' ? 0 : 1, unknownOwnershipCount: state === 'ownership-required' ? 1 : 0, userOwnedCount: state === 'user-owned-review' ? 1 : 0, userOwnedEnabledCount: state === 'user-owned-review' ? 1 : 0, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildStartupOwnershipBoundaryPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildStartupOwnershipBoundaryPlan(report({ sampleCount: 0, entryCount: 0, systemOwnedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildStartupOwnershipBoundaryEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createStartupOwnershipBoundaryLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(STARTUP_OWNERSHIP_BOUNDARY_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeStartupOwnershipBoundaryReports(null)).toThrow('reports must be an array');
    expect(() => mergeStartupOwnershipBoundaryReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeStartupOwnershipBoundaryReports([null])).toThrow('report must be an object');
    expect(() => mergeStartupOwnershipBoundaryReports([report({ turbo: 'other' })])).toThrow('requires an ownership-boundary turbo report');
    expect(() => mergeStartupOwnershipBoundaryReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeStartupOwnershipBoundaryReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeStartupOwnershipBoundaryReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeStartupOwnershipBoundaryReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeStartupOwnershipBoundaryReports([report({ entryCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeStartupOwnershipBoundaryReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeStartupOwnershipBoundaryReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildStartupOwnershipBoundaryEnvelope(report())).toThrow('trigger is required');
    expect(() => buildStartupOwnershipBoundaryEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
