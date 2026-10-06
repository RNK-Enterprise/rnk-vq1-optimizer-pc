import { WORKLOAD_ENVIRONMENT_BOUNDARY_TRIGGERS, WORKLOAD_ENVIRONMENT_BOUNDARY_TURBO_ID,
  WORKLOAD_ENVIRONMENT_BOUNDARY_TURBO_VERSION, runWorkloadEnvironmentBoundaryTurbo } from '../pc/engines/workload-profile/turbos/environment-boundary/turbo.js';
function facts(environment = 'interactive', overrides = {}) { return { engine: 'system-facts', environment, ...overrides }; }
describe('workload-profile environment-boundary turbo', () => {
  test('publishes identity and detects sustained boundary drift', () => {
    expect(WORKLOAD_ENVIRONMENT_BOUNDARY_TURBO_ID).toBe('workload-profile.environment-boundary'); expect(WORKLOAD_ENVIRONMENT_BOUNDARY_TURBO_VERSION).toBe(1); expect(Object.isFrozen(WORKLOAD_ENVIRONMENT_BOUNDARY_TRIGGERS)).toBe(true);
    const result = runWorkloadEnvironmentBoundaryTurbo([facts(), facts('headless'), facts()], { trigger: 'install.preflight', now: () => 0 });
    expect(result).toMatchObject({ turbo: WORKLOAD_ENVIRONMENT_BOUNDARY_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3, observedCount: 3, unknownCount: 0, comparisonCount: 2, changeCount: 2, finalEnvironment: 'interactive', state: 'environment-drift-sustained', confidence: 1, recommendations: ['review-environment-boundary-drift'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('reports every bounded environment state', () => {
    expect(runWorkloadEnvironmentBoundaryTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', confidence: 0, finalEnvironment: 'unknown' });
    expect(runWorkloadEnvironmentBoundaryTurbo([facts('other'), facts('other')], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'profile-required', observedCount: 0 });
    expect(runWorkloadEnvironmentBoundaryTurbo([facts(), facts('other')], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'observation-required', unknownCount: 1 });
    expect(runWorkloadEnvironmentBoundaryTurbo([facts(), facts('headless')], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'environment-drift-observed', changeCount: 1 });
    expect(runWorkloadEnvironmentBoundaryTurbo([facts(), facts()], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'interactive-boundary' });
    expect(runWorkloadEnvironmentBoundaryTurbo([facts('headless'), facts('headless')], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'headless-boundary' });
  });
  test('bounds samples and rejects malformed inputs', () => {
    expect(runWorkloadEnvironmentBoundaryTurbo([facts(), facts(), facts()], { trigger: 'health.interval', windowSize: 2, now: () => 0 })).toMatchObject({ sampleCount: 2 });
    expect(() => runWorkloadEnvironmentBoundaryTurbo([], { trigger: 'bad' })).toThrow('Unsupported workload-profile environment-boundary trigger: bad'); expect(() => runWorkloadEnvironmentBoundaryTurbo()).toThrow('trigger: unknown');
    expect(() => runWorkloadEnvironmentBoundaryTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array'); expect(() => runWorkloadEnvironmentBoundaryTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer'); expect(() => runWorkloadEnvironmentBoundaryTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer');
    expect(() => runWorkloadEnvironmentBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit'); expect(() => runWorkloadEnvironmentBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit'); expect(() => runWorkloadEnvironmentBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must fit'); expect(() => runWorkloadEnvironmentBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must fit');
    expect(() => runWorkloadEnvironmentBoundaryTurbo(null, { trigger: 'health.interval', now: () => NaN })).toThrow('samples must be an array'); expect(() => runWorkloadEnvironmentBoundaryTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object'); expect(() => runWorkloadEnvironmentBoundaryTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot'); expect(() => runWorkloadEnvironmentBoundaryTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
