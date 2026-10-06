import { THERMAL_SENSOR_STABILITY_TRIGGERS, THERMAL_SENSOR_STABILITY_TURBO_ID,
  THERMAL_SENSOR_STABILITY_TURBO_VERSION, runThermalSensorStabilityTurbo } from '../pc/engines/thermal/turbos/sensor-stability/turbo.js';

function facts(temperature, fanPercent = 40, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', thermal: { temperatureCelsius: temperature, criticalCelsius: 100, fanPercent }, ...overrides };
}
describe('thermal sensor-stability turbo', () => {
  test('publishes identity and detects sustained sensor jitter', () => {
    expect(THERMAL_SENSOR_STABILITY_TURBO_ID).toBe('thermal.sensor-stability'); expect(THERMAL_SENSOR_STABILITY_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(THERMAL_SENSOR_STABILITY_TRIGGERS)).toBe(true);
    const result = runThermalSensorStabilityTurbo([facts(50), facts(60), facts(70)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: THERMAL_SENSOR_STABILITY_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      observedCount: 3, completeCount: 3, unknownCount: 0, comparisonCount: 2, changedCount: 2, jitterCount: 2,
      jitterThreshold: 5, finalTemperatureCelsius: 70, finalFanPercent: 40, finalEnvironment: 'interactive', state: 'sensor-jitter-sustained', confidence: 1,
      recommendations: ['review-thermal-sensor-jitter-without-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes stability, observed jitter, and incomplete evidence', () => {
    expect(runThermalSensorStabilityTurbo([facts(50), facts(50)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-sensor' });
    expect(runThermalSensorStabilityTurbo([facts(50), facts(56)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'sensor-jitter-observed', jitterCount: 1 });
    expect(runThermalSensorStabilityTurbo([facts(50, 40, { thermal: { temperatureCelsius: 50, criticalCelsius: 100, fanPercent: undefined } }), facts(50)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'sensor-evidence-required', completeCount: 1, confidence: 0.5 });
    expect(runThermalSensorStabilityTurbo([facts(undefined), facts(null)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'sensor-unknown', observedCount: 0, confidence: 0 });
    expect(runThermalSensorStabilityTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, finalTemperatureCelsius: null, confidence: 0 });
  });
  test('normalizes sensor values and threshold bounds', () => {
    expect(runThermalSensorStabilityTurbo([facts(50, 120, { environment: 'other' })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalFanPercent: 100, finalEnvironment: 'unknown', state: 'stable-sensor', confidence: 1 });
    expect(runThermalSensorStabilityTurbo([facts(-1)], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalTemperatureCelsius: null, state: 'sensor-unknown' });
  });
  test('rejects invalid triggers, bounds, snapshots, thresholds, and clocks', () => {
    expect(() => runThermalSensorStabilityTurbo([], { trigger: 'bad' })).toThrow('Unsupported thermal sensor-stability trigger: bad');
    expect(() => runThermalSensorStabilityTurbo()).toThrow('Unsupported thermal sensor-stability trigger: unknown');
    expect(() => runThermalSensorStabilityTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runThermalSensorStabilityTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runThermalSensorStabilityTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runThermalSensorStabilityTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runThermalSensorStabilityTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runThermalSensorStabilityTurbo([], { trigger: 'health.interval', jitterThreshold: 0 })).toThrow('jitterThreshold must be from 0.1 to 50');
    expect(() => runThermalSensorStabilityTurbo([], { trigger: 'health.interval', jitterThreshold: 51 })).toThrow('jitterThreshold must be from 0.1 to 50');
    expect(() => runThermalSensorStabilityTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runThermalSensorStabilityTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runThermalSensorStabilityTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runThermalSensorStabilityTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runThermalSensorStabilityTurbo([{ engine: 'system-facts', thermal: null }], { trigger: 'health.interval' })).toThrow('requires a thermal object');
    expect(() => runThermalSensorStabilityTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
