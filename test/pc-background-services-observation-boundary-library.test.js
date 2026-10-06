import { BACKGROUND_OBSERVATION_LIBRARY_ID, BACKGROUND_OBSERVATION_LIBRARY_VERSION,
  buildBackgroundObservationEnvelope, buildBackgroundObservationPlan, createBackgroundObservationLibrary,
  mergeBackgroundObservationReports } from '../pc/engines/background-services/turbos/observation-boundary/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'background-services.observation-boundary', state: 'observation-enabled', sampleCount,
    minimumSamples: 2, serviceCount: 2, observation: 'enabled', finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('background-services observation-boundary library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeBackgroundObservationReports([report({ sampleCount: 2 }), report({ state: 'observation-disabled', observation: 'disabled', finalEnvironment: 'headless' })]);
    expect(BACKGROUND_OBSERVATION_LIBRARY_ID).toBe('background-services.observation-boundary.library');
    expect(BACKGROUND_OBSERVATION_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'observation-disabled', sampleCount: 6, serviceCount: 2, observation: 'disabled', finalEnvironment: 'headless', recommendations: ['keep-service-observation-disabled'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeBackgroundObservationReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-observation-samples'] });
    expect(mergeBackgroundObservationReports([report({ state: 'observation-capability-unknown', observation: 'unknown' })]).recommendations).toEqual(['request-observation-capability']);
    expect(mergeBackgroundObservationReports([report({ state: 'no-services', serviceCount: 0, observation: 'enabled', confidence: 0 })]).recommendations).toEqual(['no-background-service-review']);
    expect(mergeBackgroundObservationReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeBackgroundObservationReports([report({ state: 'insufficient-data', sampleCount: 1, serviceCount: 0, observation: 'unknown', confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, observation] of [['observation-disabled', 'disabled-preservation', 10000, 'disabled'], ['observation-capability-unknown', 'capability-bootstrap', 2000, 'unknown'], ['no-services', 'empty-observation', 10000, 'enabled'], ['insufficient-data', 'sample-bootstrap', 2000, 'unknown'], ['observation-enabled', 'stable-observation', 5000, 'enabled']]) {
      const empty = state === 'no-services' || state === 'insufficient-data'; const sampleCount = state === 'insufficient-data' ? 0 : (empty ? 1 : 4);
      expect(buildBackgroundObservationPlan(report({ state, sampleCount, serviceCount: empty ? 0 : 2, observation, confidence: empty ? 0 : 1 }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildBackgroundObservationPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildBackgroundObservationPlan(report({ sampleCount: 0, serviceCount: 0, observation: 'unknown', confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildBackgroundObservationEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createBackgroundObservationLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(BACKGROUND_OBSERVATION_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeBackgroundObservationReports(null)).toThrow('reports must be an array');
    expect(() => mergeBackgroundObservationReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeBackgroundObservationReports([null])).toThrow('report must be an object');
    expect(() => mergeBackgroundObservationReports([report({ turbo: 'other' })])).toThrow('requires an observation-boundary turbo report');
    expect(() => mergeBackgroundObservationReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeBackgroundObservationReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeBackgroundObservationReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeBackgroundObservationReports([report({ serviceCount: 4097 })])).toThrow('service count must be from 0 to 4096');
    expect(() => mergeBackgroundObservationReports([report({ observation: 'other' })])).toThrow('observation must be normalized');
    expect(() => mergeBackgroundObservationReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeBackgroundObservationReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildBackgroundObservationEnvelope(report())).toThrow('trigger is required');
    expect(() => buildBackgroundObservationEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
