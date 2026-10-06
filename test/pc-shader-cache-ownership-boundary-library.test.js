import { SHADER_OWNERSHIP_BOUNDARY_LIBRARY_ID, SHADER_OWNERSHIP_BOUNDARY_LIBRARY_VERSION,
  buildShaderOwnershipBoundaryEnvelope, buildShaderOwnershipBoundaryPlan, createShaderOwnershipBoundaryLibrary,
  mergeShaderOwnershipBoundaryReports } from '../pc/engines/shader-cache/turbos/ownership-boundary/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'shader-cache.ownership-boundary', state: 'stable-ownership', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    cacheCount: 1, systemOwnedCount: 1, userOwnedCount: 0, unknownOwnershipCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changeCount: 0,
    finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('shader-cache ownership-boundary library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeShaderOwnershipBoundaryReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'user-owned-review', userOwnedCount: 1, systemOwnedCount: 0, changeCount: 1, finalEnvironment: 'headless' })]);
    expect(SHADER_OWNERSHIP_BOUNDARY_LIBRARY_ID).toBe('shader-cache.ownership-boundary.library'); expect(SHADER_OWNERSHIP_BOUNDARY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'user-owned-review', sampleCount: 6, cacheCount: 1, userOwnedCount: 1, comparisonCount: 4, changeCount: 1, finalEnvironment: 'headless', recommendations: ['preserve-user-owned-cache-boundary'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeShaderOwnershipBoundaryReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-cache-ownership-samples'] });
    expect(mergeShaderOwnershipBoundaryReports([report({ state: 'no-caches', cacheCount: 0, systemOwnedCount: 0, comparisonCount: 0, confidence: 0.5 })]).recommendations).toEqual(['no-shader-cache-review']);
    expect(mergeShaderOwnershipBoundaryReports([report({ state: 'ownership-required', unknownOwnershipCount: 1, systemOwnedCount: 0 })]).recommendations).toEqual(['request-shader-cache-ownership']);
    expect(mergeShaderOwnershipBoundaryReports([report({ state: 'ownership-drift-sustained', changeCount: 2 })]).recommendations).toEqual(['review-cache-ownership-drift-without-mutation']);
    expect(mergeShaderOwnershipBoundaryReports([report({ state: 'ownership-drift-observed', changeCount: 1 })]).recommendations).toEqual(['observe-cache-ownership-stability']);
    expect(mergeShaderOwnershipBoundaryReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeShaderOwnershipBoundaryReports([report({ state: 'insufficient-data', sampleCount: 1, cacheCount: 0, systemOwnedCount: 0, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, sampleCount, cacheCount, confidence] of [['no-caches', 'empty-observation', 10000, 4, 0, 0.5], ['user-owned-review', 'user-boundary', 750, 4, 1, 1], ['ownership-required', 'ownership-bootstrap', 2000, 4, 1, 0.5], ['ownership-drift-sustained', 'ownership-review', 1000, 4, 1, 1], ['ownership-drift-observed', 'ownership-observation', 1500, 4, 1, 1], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0, 0], ['stable-ownership', 'stable-observation', 5000, 4, 1, 1]]) {
      expect(buildShaderOwnershipBoundaryPlan(report({ state, sampleCount, cacheCount, systemOwnedCount: state === 'user-owned-review' ? 0 : cacheCount, userOwnedCount: state === 'user-owned-review' ? 1 : 0, unknownOwnershipCount: state === 'ownership-required' ? 1 : 0, comparisonCount: Math.max(0, sampleCount - 1), confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildShaderOwnershipBoundaryPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildShaderOwnershipBoundaryPlan(report({ sampleCount: 0, cacheCount: 0, systemOwnedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildShaderOwnershipBoundaryEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createShaderOwnershipBoundaryLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(SHADER_OWNERSHIP_BOUNDARY_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeShaderOwnershipBoundaryReports(null)).toThrow('reports must be an array');
    expect(() => mergeShaderOwnershipBoundaryReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeShaderOwnershipBoundaryReports([null])).toThrow('report must be an object');
    expect(() => mergeShaderOwnershipBoundaryReports([report({ turbo: 'other' })])).toThrow('requires an ownership-boundary turbo report');
    expect(() => mergeShaderOwnershipBoundaryReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeShaderOwnershipBoundaryReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeShaderOwnershipBoundaryReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeShaderOwnershipBoundaryReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeShaderOwnershipBoundaryReports([report({ cacheCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeShaderOwnershipBoundaryReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeShaderOwnershipBoundaryReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildShaderOwnershipBoundaryEnvelope(report())).toThrow('trigger is required');
    expect(() => buildShaderOwnershipBoundaryEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
