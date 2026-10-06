import { SHADER_VALIDITY_DRIFT_LIBRARY_ID, SHADER_VALIDITY_DRIFT_LIBRARY_VERSION,
  buildShaderValidityDriftEnvelope, buildShaderValidityDriftPlan, createShaderValidityDriftLibrary,
  mergeShaderValidityDriftReports } from '../pc/engines/shader-cache/turbos/validity-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'shader-cache.validity-drift', state: 'stable-validity', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    cacheCount: 1, validCount: 1, staleCount: 0, unknownCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changeCount: 0,
    finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('shader-cache validity-drift library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeShaderValidityDriftReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'validity-drift-sustained', changeCount: 2, finalEnvironment: 'headless' })]);
    expect(SHADER_VALIDITY_DRIFT_LIBRARY_ID).toBe('shader-cache.validity-drift.library'); expect(SHADER_VALIDITY_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'validity-drift-sustained', sampleCount: 6, cacheCount: 1, validCount: 1, comparisonCount: 4, changeCount: 2, finalEnvironment: 'headless', recommendations: ['review-validity-drift-without-cache-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeShaderValidityDriftReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-cache-validity-samples'] });
    expect(mergeShaderValidityDriftReports([report({ state: 'no-caches', cacheCount: 0, validCount: 0, comparisonCount: 0, confidence: 0.5 })]).recommendations).toEqual(['no-shader-cache-review']);
    expect(mergeShaderValidityDriftReports([report({ state: 'observation-required', unknownCount: 1, validCount: 0 })]).recommendations).toEqual(['request-shader-cache-validity-observation']);
    expect(mergeShaderValidityDriftReports([report({ state: 'validity-drift-observed', changeCount: 1 })]).recommendations).toEqual(['observe-shader-cache-validity']);
    expect(mergeShaderValidityDriftReports([report({ state: 'stale-review', staleCount: 1 })]).recommendations).toEqual(['review-driver-documented-rebuild-path']);
    expect(mergeShaderValidityDriftReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeShaderValidityDriftReports([report({ state: 'insufficient-data', sampleCount: 1, cacheCount: 0, validCount: 0, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, sampleCount, cacheCount, confidence] of [['no-caches', 'empty-observation', 10000, 4, 0, 0.5], ['validity-drift-sustained', 'validity-review', 1000, 4, 1, 1], ['validity-drift-observed', 'validity-observation', 1500, 4, 1, 1], ['stale-review', 'stale-review', 1500, 4, 1, 1], ['observation-required', 'evidence-bootstrap', 2000, 4, 1, 0.5], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0, 0], ['stable-validity', 'stable-observation', 5000, 4, 1, 1]]) {
      expect(buildShaderValidityDriftPlan(report({ state, sampleCount, cacheCount, validCount: cacheCount, unknownCount: state === 'observation-required' ? 1 : 0, comparisonCount: Math.max(0, sampleCount - 1), confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildShaderValidityDriftPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildShaderValidityDriftPlan(report({ sampleCount: 0, cacheCount: 0, validCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildShaderValidityDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createShaderValidityDriftLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(SHADER_VALIDITY_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeShaderValidityDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeShaderValidityDriftReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeShaderValidityDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeShaderValidityDriftReports([report({ turbo: 'other' })])).toThrow('requires a validity-drift turbo report');
    expect(() => mergeShaderValidityDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeShaderValidityDriftReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeShaderValidityDriftReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeShaderValidityDriftReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeShaderValidityDriftReports([report({ cacheCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeShaderValidityDriftReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeShaderValidityDriftReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildShaderValidityDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildShaderValidityDriftEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
