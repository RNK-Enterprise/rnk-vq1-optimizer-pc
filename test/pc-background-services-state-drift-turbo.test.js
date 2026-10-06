import { BACKGROUND_STATE_DRIFT_TRIGGERS, BACKGROUND_STATE_DRIFT_TURBO_ID,
  BACKGROUND_STATE_DRIFT_TURBO_VERSION, runBackgroundStateDriftTurbo } from '../pc/engines/background-services/turbos/state-drift/turbo.js';

const service = (name, state, overrides = {}) => ({ name, state, ...overrides });
const facts = (services = [], overrides = {}) => ({ engine: 'system-facts', environment: 'interactive', services, ...overrides });

describe('background-services state-drift turbo', () => {
  test('publishes identity and detects sustained drift', () => {
    expect(BACKGROUND_STATE_DRIFT_TURBO_ID).toBe('background-services.state-drift');
    expect(BACKGROUND_STATE_DRIFT_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(BACKGROUND_STATE_DRIFT_TRIGGERS)).toBe(true);
    const result = runBackgroundStateDriftTurbo([
      facts([service('a', 'running')]), facts([service('a', 'stopped')]), facts([service('a', 'failed', { critical: true })])
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: BACKGROUND_STATE_DRIFT_TURBO_ID, sampleCount: 3,
      serviceCount: 1, namedCount: 1, runningCount: 0, stoppedCount: 0, failedCount: 1,
      changeCount: 2, runningChangeCount: 1, stoppedChangeCount: 2, failedChangeCount: 1,
      state: 'protect-services', criticalFailureCount: 1, confidence: 1, actions: [] });
  });
  test('covers stable, observed, unknown, critical, empty, and insufficient states', () => {
    expect(runBackgroundStateDriftTurbo([facts([service('a', 'running')]), facts([service('a', 'running')])], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-services' });
    expect(runBackgroundStateDriftTurbo([facts([service('a', 'running')]), facts([service('a', 'stopped')])], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'state-drift-observed' });
    expect(runBackgroundStateDriftTurbo([facts([service('a', 'running')]), facts([service('a', 'stopped')]), facts([service('a', 'failed')])], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'state-drift-sustained' });
    expect(runBackgroundStateDriftTurbo([facts([service('a', 'other')]), facts([service('a', '')])], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'observation-required' });
    expect(runBackgroundStateDriftTurbo([facts([service('a', 'failed', { critical: true })])], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'protect-services', recommendations: ['protect-services', 'review-service-owner'] });
    expect(runBackgroundStateDriftTurbo([facts([]), facts([])], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-services' });
    expect(runBackgroundStateDriftTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes rows and unknown environments', () => {
    expect(runBackgroundStateDriftTurbo([facts([null, service('', 'running'), service('a', ' RUNNING ')], { environment: 'other' })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ finalEnvironment: 'unknown', serviceCount: 2, namedCount: 1, state: 'stable-services', confidence: 0.5 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runBackgroundStateDriftTurbo([], { trigger: 'bad' })).toThrow('Unsupported background-services state-drift trigger: bad');
    expect(() => runBackgroundStateDriftTurbo()).toThrow('Unsupported background-services state-drift trigger: unknown');
    expect(() => runBackgroundStateDriftTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runBackgroundStateDriftTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runBackgroundStateDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runBackgroundStateDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runBackgroundStateDriftTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runBackgroundStateDriftTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runBackgroundStateDriftTurbo([{ engine: 'system-facts', services: null }], { trigger: 'health.interval' })).toThrow('requires a service list');
    expect(() => runBackgroundStateDriftTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
