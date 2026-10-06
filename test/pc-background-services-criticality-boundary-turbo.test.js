import { BACKGROUND_CRITICALITY_TRIGGERS, BACKGROUND_CRITICALITY_TURBO_ID,
  BACKGROUND_CRITICALITY_TURBO_VERSION, runBackgroundCriticalityBoundaryTurbo } from '../pc/engines/background-services/turbos/criticality-boundary/turbo.js';

const service = (state, overrides = {}) => ({ state, critical: true, ...overrides });
const facts = (services = [], overrides = {}) => ({ engine: 'system-facts', environment: 'headless', services, ...overrides });

describe('background-services criticality-boundary turbo', () => {
  test('publishes identity and protects failed critical services', () => {
    expect(BACKGROUND_CRITICALITY_TURBO_ID).toBe('background-services.criticality-boundary');
    expect(BACKGROUND_CRITICALITY_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(BACKGROUND_CRITICALITY_TRIGGERS)).toBe(true);
    const result = runBackgroundCriticalityBoundaryTurbo([facts([service('failed', { userOwned: true })])], { trigger: 'install.preflight', minimumSamples: 1, now: () => 0 });
    expect(result).toMatchObject({ turbo: BACKGROUND_CRITICALITY_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 1,
      criticalCount: 1, failedCriticalCount: 1, unknownCriticalCount: 0, userOwnedCriticalCount: 1,
      state: 'protect-critical-services', confidence: 1, recommendations: ['protect-critical-services', 'review-service-owner'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('covers observe, unknown, empty, and insufficient states', () => {
    expect(runBackgroundCriticalityBoundaryTurbo([facts([service('running')]), facts([service('stopped')])], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'critical-services-observe' });
    expect(runBackgroundCriticalityBoundaryTurbo([facts([service('other')])], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'critical-observation-required', unknownCriticalCount: 1 });
    expect(runBackgroundCriticalityBoundaryTurbo([facts([{ state: 'running', critical: false }])], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'no-critical-services' });
    expect(runBackgroundCriticalityBoundaryTurbo([facts([]), facts([])], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-critical-services', confidence: 0 });
    expect(runBackgroundCriticalityBoundaryTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes rows and unknown environments', () => {
    expect(runBackgroundCriticalityBoundaryTurbo([facts([null, { state: 'running', critical: true }, { state: '', critical: false }], { environment: 'other' })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ finalEnvironment: 'unknown', serviceCount: 2, criticalCount: 1 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runBackgroundCriticalityBoundaryTurbo([], { trigger: 'bad' })).toThrow('Unsupported background-services criticality-boundary trigger: bad');
    expect(() => runBackgroundCriticalityBoundaryTurbo()).toThrow('Unsupported background-services criticality-boundary trigger: unknown');
    expect(() => runBackgroundCriticalityBoundaryTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runBackgroundCriticalityBoundaryTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runBackgroundCriticalityBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runBackgroundCriticalityBoundaryTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runBackgroundCriticalityBoundaryTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runBackgroundCriticalityBoundaryTurbo([{ engine: 'system-facts', services: null }], { trigger: 'health.interval' })).toThrow('requires a service list');
    expect(() => runBackgroundCriticalityBoundaryTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
