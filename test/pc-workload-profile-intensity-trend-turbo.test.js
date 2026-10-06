import { WORKLOAD_INTENSITY_TREND_TRIGGERS, WORKLOAD_INTENSITY_TREND_TURBO_ID,
  WORKLOAD_INTENSITY_TREND_TURBO_VERSION, runWorkloadIntensityTrendTurbo } from '../pc/engines/workload-profile/turbos/intensity-trend/turbo.js';

function facts(intensity, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', workload: { intensity }, ...overrides };
}
describe('workload-profile intensity-trend turbo', () => {
  test('publishes identity and reports sustained intensity movement', () => {
    expect(WORKLOAD_INTENSITY_TREND_TURBO_ID).toBe('workload-profile.intensity-trend'); expect(WORKLOAD_INTENSITY_TREND_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(WORKLOAD_INTENSITY_TREND_TRIGGERS)).toBe(true);
    const result = runWorkloadIntensityTrendTurbo([facts(20), facts(40), facts(60)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: WORKLOAD_INTENSITY_TREND_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      observedCount: 3, unknownCount: 0, comparisonCount: 2, changedCount: 2, risingCount: 2, fallingCount: 0,
      finalIntensity: 60, state: 'intensity-rise-sustained', confidence: 1,
      recommendations: ['review-sustained-workload-intensity-rise'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('covers movement, threshold, and level states', () => {
    expect(runWorkloadIntensityTrendTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', confidence: 0, finalIntensity: null });
    expect(runWorkloadIntensityTrendTurbo([facts(undefined), facts(null)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'intensity-unknown', observedCount: 0 });
    expect(runWorkloadIntensityTrendTurbo([facts(20), facts(undefined)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'observation-required', unknownCount: 1 });
    expect(runWorkloadIntensityTrendTurbo([facts(70), facts(60), facts(50)], { trigger: 'workload.changed', now: () => 0 })).toMatchObject({ state: 'intensity-fall-sustained', fallingCount: 2 });
    expect(runWorkloadIntensityTrendTurbo([facts(40), facts(50)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'intensity-rise-observed', risingCount: 1 });
    expect(runWorkloadIntensityTrendTurbo([facts(50), facts(40)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'intensity-fall-observed', fallingCount: 1 });
    expect(runWorkloadIntensityTrendTurbo([facts(80), facts(80)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'high-intensity' });
    expect(runWorkloadIntensityTrendTurbo([facts(20), facts(20)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'low-intensity' });
    expect(runWorkloadIntensityTrendTurbo([facts(50), facts(50)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-intensity' });
    expect(runWorkloadIntensityTrendTurbo([facts(-1), facts(101)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'intensity-unknown', observedCount: 0 });
    expect(runWorkloadIntensityTrendTurbo([facts(50, { environment: 'other' }), facts(50, { environment: 'other' })], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ finalEnvironment: 'unknown', state: 'stable-intensity' });
  });
  test('bounds samples and validates local inputs', () => {
    expect(runWorkloadIntensityTrendTurbo([facts(1), facts(2), facts(3)], { trigger: 'workload.changed', windowSize: 2, now: () => 0 })).toMatchObject({ sampleCount: 2 });
    expect(() => runWorkloadIntensityTrendTurbo([], { trigger: 'bad' })).toThrow('Unsupported workload-profile intensity-trend trigger: bad');
    expect(() => runWorkloadIntensityTrendTurbo()).toThrow('Unsupported workload-profile intensity-trend trigger: unknown');
    expect(() => runWorkloadIntensityTrendTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runWorkloadIntensityTrendTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer');
    expect(() => runWorkloadIntensityTrendTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer');
    expect(() => runWorkloadIntensityTrendTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit');
    expect(() => runWorkloadIntensityTrendTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit');
    expect(() => runWorkloadIntensityTrendTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must fit');
    expect(() => runWorkloadIntensityTrendTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must fit');
    expect(() => runWorkloadIntensityTrendTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runWorkloadIntensityTrendTurbo([{ engine: 'other', workload: {} }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runWorkloadIntensityTrendTurbo([{ engine: 'system-facts' }], { trigger: 'health.interval' })).toThrow('requires a workload object');
    expect(() => runWorkloadIntensityTrendTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
