import { BACKGROUND_OBSERVATION_TRIGGERS, BACKGROUND_OBSERVATION_TURBO_ID,
  BACKGROUND_OBSERVATION_TURBO_VERSION, runBackgroundObservationBoundaryTurbo } from '../pc/engines/background-services/turbos/observation-boundary/turbo.js';

const facts = (services = [{}], capabilities, overrides = {}) => ({ engine: 'system-facts', environment: 'interactive', services, capabilities, ...overrides });

describe('background-services observation-boundary turbo', () => {
  test('publishes identity and reports enabled observation', () => {
    expect(BACKGROUND_OBSERVATION_TURBO_ID).toBe('background-services.observation-boundary');
    expect(BACKGROUND_OBSERVATION_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(BACKGROUND_OBSERVATION_TRIGGERS)).toBe(true);
    const result = runBackgroundObservationBoundaryTurbo([facts([{}], { backgroundServiceObservation: true })], { trigger: 'install.preflight', minimumSamples: 1, now: () => 0 });
    expect(result).toMatchObject({ turbo: BACKGROUND_OBSERVATION_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 1,
      serviceCount: 1, observation: 'enabled', finalEnvironment: 'interactive', state: 'observation-enabled', confidence: 1, actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('covers disabled, unknown, empty, and insufficient states', () => {
    expect(runBackgroundObservationBoundaryTurbo([facts([{}], { backgroundServiceObservation: false })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'observation-disabled', confidence: 1 });
    expect(runBackgroundObservationBoundaryTurbo([facts([{}], {}), facts([{}], null)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'observation-capability-unknown', observation: 'unknown', confidence: 0 });
    expect(runBackgroundObservationBoundaryTurbo([facts([], { backgroundServiceObservation: true }), facts([], { backgroundServiceObservation: false })], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-services' });
    expect(runBackgroundObservationBoundaryTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes rows and unknown environments', () => {
    expect(runBackgroundObservationBoundaryTurbo([facts([null, {}], { backgroundServiceObservation: true }, { environment: 'other' })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ finalEnvironment: 'unknown', serviceCount: 1 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runBackgroundObservationBoundaryTurbo([], { trigger: 'bad' })).toThrow('Unsupported background-services observation-boundary trigger: bad');
    expect(() => runBackgroundObservationBoundaryTurbo()).toThrow('Unsupported background-services observation-boundary trigger: unknown');
    expect(() => runBackgroundObservationBoundaryTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runBackgroundObservationBoundaryTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runBackgroundObservationBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runBackgroundObservationBoundaryTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runBackgroundObservationBoundaryTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runBackgroundObservationBoundaryTurbo([{ engine: 'system-facts', services: null }], { trigger: 'health.interval' })).toThrow('requires a service list');
    expect(() => runBackgroundObservationBoundaryTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
