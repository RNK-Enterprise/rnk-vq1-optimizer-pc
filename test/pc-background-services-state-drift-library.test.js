import { BACKGROUND_STATE_DRIFT_LIBRARY_ID, BACKGROUND_STATE_DRIFT_LIBRARY_VERSION,
  buildBackgroundStateDriftEnvelope, buildBackgroundStateDriftPlan, createBackgroundStateDriftLibrary,
  mergeBackgroundStateDriftReports } from '../pc/engines/background-services/turbos/state-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'background-services.state-drift', state: 'stable-services', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, serviceCount: 2, namedCount: 2, runningCount: 2,
    stoppedCount: 0, failedCount: 0, unknownCount: 0, criticalFailureCount: 0,
    comparisonCount: overrides.comparisonCount ?? Math.max(0, sampleCount - 1), changeCount: 0,
    runningChangeCount: 0, stoppedChangeCount: 0, failedChangeCount: 0, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('background-services state-drift library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeBackgroundStateDriftReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'state-drift-sustained', sampleCount: 4, comparisonCount: 3, changeCount: 2, finalEnvironment: 'headless' })]);
    expect(BACKGROUND_STATE_DRIFT_LIBRARY_ID).toBe('background-services.state-drift.library');
    expect(BACKGROUND_STATE_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'state-drift-sustained', sampleCount: 6, serviceCount: 2, comparisonCount: 4, changeCount: 2, finalEnvironment: 'headless', confidence: 1, recommendations: ['review-service-state-drift'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeBackgroundStateDriftReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-service-samples'] });
    expect(mergeBackgroundStateDriftReports([report({ state: 'protect-services', criticalFailureCount: 1 })]).recommendations).toEqual(['protect-services', 'review-service-owner']);
    expect(mergeBackgroundStateDriftReports([report({ state: 'state-drift-observed', comparisonCount: 1, changeCount: 1 })]).recommendations).toEqual(['observe-service-state-stability']);
    expect(mergeBackgroundStateDriftReports([report({ state: 'observation-required', unknownCount: 1 })]).recommendations).toEqual(['request-service-state-observation']);
    expect(mergeBackgroundStateDriftReports([report({ state: 'no-services', serviceCount: 0, namedCount: 0, comparisonCount: 0 })]).recommendations).toEqual(['no-background-service-review']);
    expect(mergeBackgroundStateDriftReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeBackgroundStateDriftReports([report({ state: 'insufficient-data', sampleCount: 1, serviceCount: 0, namedCount: 0, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs] of [['protect-services', 'service-protection', 500], ['state-drift-sustained', 'state-review', 1000], ['state-drift-observed', 'state-observation', 1500], ['observation-required', 'evidence-bootstrap', 2000], ['no-services', 'empty-observation', 10000], ['insufficient-data', 'sample-bootstrap', 2000], ['stable-services', 'stable-observation', 5000]]) {
      const empty = state === 'no-services' || state === 'insufficient-data'; const sampleCount = state === 'insufficient-data' ? 0 : (empty ? 1 : 4);
      expect(buildBackgroundStateDriftPlan(report({ state, sampleCount, serviceCount: empty ? 0 : 2, namedCount: empty ? 0 : 2, comparisonCount: Math.max(0, sampleCount - 1), confidence: empty ? 0 : 1 }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildBackgroundStateDriftPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildBackgroundStateDriftPlan(report({ sampleCount: 0, serviceCount: 0, namedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildBackgroundStateDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createBackgroundStateDriftLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(BACKGROUND_STATE_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeBackgroundStateDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeBackgroundStateDriftReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeBackgroundStateDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeBackgroundStateDriftReports([report({ turbo: 'other' })])).toThrow('requires a state-drift turbo report');
    expect(() => mergeBackgroundStateDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeBackgroundStateDriftReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeBackgroundStateDriftReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeBackgroundStateDriftReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeBackgroundStateDriftReports([report({ serviceCount: 4097 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeBackgroundStateDriftReports([report({ comparisonCount: 4 })])).toThrow('comparisonCount must fit inside the sample window');
    expect(() => mergeBackgroundStateDriftReports([report({ comparisonCount: 1, changeCount: 2 })])).toThrow('change count must fit inside comparisonCount');
    expect(() => mergeBackgroundStateDriftReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeBackgroundStateDriftReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildBackgroundStateDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildBackgroundStateDriftEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
