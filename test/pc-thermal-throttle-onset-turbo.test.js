import { THERMAL_THROTTLE_ONSET_TRIGGERS, THERMAL_THROTTLE_ONSET_TURBO_ID,
  THERMAL_THROTTLE_ONSET_TURBO_VERSION, runThermalThrottleOnsetTurbo } from '../pc/engines/thermal/turbos/throttle-onset/turbo.js';

function facts(temperature, critical = 100, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', thermal: { temperatureCelsius: temperature, criticalCelsius: critical }, ...overrides };
}
describe('thermal throttle-onset turbo', () => {
  test('publishes identity and detects sustained throttle risk', () => {
    expect(THERMAL_THROTTLE_ONSET_TURBO_ID).toBe('thermal.throttle-onset'); expect(THERMAL_THROTTLE_ONSET_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(THERMAL_THROTTLE_ONSET_TRIGGERS)).toBe(true);
    const result = runThermalThrottleOnsetTurbo([facts(80), facts(90), facts(95)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: THERMAL_THROTTLE_ONSET_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      observedCount: 3, unknownCount: 0, comparisonCount: 2, changedCount: 1, crossingCount: 1, riskCount: 2,
      finalRatioPercent: 95, finalBand: 'throttle-risk', finalEnvironment: 'interactive', state: 'throttle-risk-sustained', confidence: 1,
      recommendations: ['review-throttle-risk-without-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes threshold bands, crossings, and evidence states', () => {
    expect(runThermalThrottleOnsetTurbo([facts(50), facts(50)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'below-threshold' });
    expect(runThermalThrottleOnsetTurbo([facts(80), facts(80)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'watch-threshold' });
    expect(runThermalThrottleOnsetTurbo([facts(95)], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'throttle-risk' });
    expect(runThermalThrottleOnsetTurbo([facts(100), facts(101)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'critical-threshold', finalBand: 'critical-threshold' });
    expect(runThermalThrottleOnsetTurbo([facts(80), facts(95), facts(50)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'threshold-crossing-sustained', crossingCount: 2 });
    expect(runThermalThrottleOnsetTurbo([facts(80), facts(95), facts(50)], { trigger: 'workload.changed', persistenceThreshold: 3, now: () => 0 })).toMatchObject({ state: 'threshold-crossing-observed', crossingCount: 2 });
    expect(runThermalThrottleOnsetTurbo([facts(80), facts(95), facts(95)], { trigger: 'workload.changed', persistenceThreshold: 3, now: () => 0 })).toMatchObject({ state: 'throttle-risk', crossingCount: 1 });
    expect(runThermalThrottleOnsetTurbo([facts(50), facts(undefined)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'observation-required', unknownCount: 1 });
    expect(runThermalThrottleOnsetTurbo([facts(undefined), facts(null)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'threshold-unknown', observedCount: 0, confidence: 0 });
    expect(runThermalThrottleOnsetTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, finalRatioPercent: null, confidence: 0 });
  });
  test('normalizes ratio and environment evidence', () => {
    expect(runThermalThrottleOnsetTurbo([facts(120, 100, { environment: 'other' })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalRatioPercent: 120, finalBand: 'critical-threshold', finalEnvironment: 'unknown', confidence: 1 });
    expect(runThermalThrottleOnsetTurbo([facts(50, 0)], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalRatioPercent: null, finalBand: 'unknown', state: 'threshold-unknown' });
  });
  test('rejects invalid triggers, bounds, snapshots, and clocks', () => {
    expect(() => runThermalThrottleOnsetTurbo([], { trigger: 'bad' })).toThrow('Unsupported thermal throttle-onset trigger: bad');
    expect(() => runThermalThrottleOnsetTurbo()).toThrow('Unsupported thermal throttle-onset trigger: unknown');
    expect(() => runThermalThrottleOnsetTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runThermalThrottleOnsetTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runThermalThrottleOnsetTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runThermalThrottleOnsetTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runThermalThrottleOnsetTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runThermalThrottleOnsetTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runThermalThrottleOnsetTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runThermalThrottleOnsetTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runThermalThrottleOnsetTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runThermalThrottleOnsetTurbo([{ engine: 'system-facts', thermal: null }], { trigger: 'health.interval' })).toThrow('requires a thermal object');
    expect(() => runThermalThrottleOnsetTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
