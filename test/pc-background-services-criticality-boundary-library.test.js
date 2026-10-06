import { BACKGROUND_CRITICALITY_LIBRARY_ID, BACKGROUND_CRITICALITY_LIBRARY_VERSION,
  buildBackgroundCriticalityEnvelope, buildBackgroundCriticalityPlan, createBackgroundCriticalityLibrary,
  mergeBackgroundCriticalityReports } from '../pc/engines/background-services/turbos/criticality-boundary/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'background-services.criticality-boundary', state: 'critical-services-observe', sampleCount,
    minimumSamples: 2, serviceCount: 2, criticalCount: 1, failedCriticalCount: 0, unknownCriticalCount: 0,
    userOwnedCriticalCount: 0, finalEnvironment: 'headless', confidence: 1, ...overrides };
}
describe('background-services criticality-boundary library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeBackgroundCriticalityReports([report({ sampleCount: 2 }), report({ state: 'protect-critical-services', failedCriticalCount: 1, userOwnedCriticalCount: 1, finalEnvironment: 'interactive' })]);
    expect(BACKGROUND_CRITICALITY_LIBRARY_ID).toBe('background-services.criticality-boundary.library');
    expect(BACKGROUND_CRITICALITY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'protect-critical-services', sampleCount: 6, serviceCount: 2, criticalCount: 1, failedCriticalCount: 1, userOwnedCriticalCount: 1, finalEnvironment: 'interactive', recommendations: ['protect-critical-services', 'review-service-owner'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeBackgroundCriticalityReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-critical-service-samples'] });
    expect(mergeBackgroundCriticalityReports([report({ state: 'critical-observation-required', unknownCriticalCount: 1 })]).recommendations).toEqual(['request-critical-service-state-observation']);
    expect(mergeBackgroundCriticalityReports([report({ state: 'no-critical-services', criticalCount: 0, serviceCount: 1, confidence: 0 })]).recommendations).toEqual(['no-critical-service-review']);
    expect(mergeBackgroundCriticalityReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeBackgroundCriticalityReports([report({ state: 'insufficient-data', sampleCount: 1, criticalCount: 0, serviceCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs] of [['protect-critical-services', 'critical-protection', 500], ['critical-observation-required', 'critical-evidence-bootstrap', 2000], ['no-critical-services', 'empty-observation', 10000], ['insufficient-data', 'sample-bootstrap', 2000], ['critical-services-observe', 'critical-observation', 5000]]) {
      const empty = state === 'no-critical-services' || state === 'insufficient-data'; const sampleCount = state === 'insufficient-data' ? 0 : (empty ? 1 : 4);
      expect(buildBackgroundCriticalityPlan(report({ state, sampleCount, serviceCount: empty ? 0 : 2, criticalCount: empty ? 0 : 1, confidence: empty ? 0 : 1 }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildBackgroundCriticalityPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildBackgroundCriticalityPlan(report({ sampleCount: 0, serviceCount: 0, criticalCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildBackgroundCriticalityEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createBackgroundCriticalityLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(BACKGROUND_CRITICALITY_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeBackgroundCriticalityReports(null)).toThrow('reports must be an array');
    expect(() => mergeBackgroundCriticalityReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeBackgroundCriticalityReports([null])).toThrow('report must be an object');
    expect(() => mergeBackgroundCriticalityReports([report({ turbo: 'other' })])).toThrow('requires a criticality-boundary turbo report');
    expect(() => mergeBackgroundCriticalityReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeBackgroundCriticalityReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeBackgroundCriticalityReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeBackgroundCriticalityReports([report({ serviceCount: 4097 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeBackgroundCriticalityReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeBackgroundCriticalityReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildBackgroundCriticalityEnvelope(report())).toThrow('trigger is required');
    expect(() => buildBackgroundCriticalityEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
