import { THERMAL_MARGIN_TRIGGERS, THERMAL_MARGIN_TURBO_ID,
  THERMAL_MARGIN_TURBO_VERSION, runThermalMarginTurbo } from '../pc/engines/thermal/turbos/thermal-margin/turbo.js';

function facts(temperature, critical = 100, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', thermal: { temperatureCelsius: temperature, criticalCelsius: critical }, ...overrides };
}
describe('thermal thermal-margin turbo', () => {
  test('publishes identity and detects sustained margin collapse', () => {
    expect(THERMAL_MARGIN_TURBO_ID).toBe('thermal.thermal-margin'); expect(THERMAL_MARGIN_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(THERMAL_MARGIN_TRIGGERS)).toBe(true);
    const result = runThermalMarginTurbo([facts(55), facts(65), facts(75)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: THERMAL_MARGIN_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      observedCount: 3, unknownCount: 0, comparisonCount: 2, changedCount: 2, fallingCount: 2, risingCount: 0,
      finalHeadroomCelsius: 25, finalTemperatureCelsius: 75, finalCriticalCelsius: 100, finalEnvironment: 'interactive',
      state: 'margin-collapse-sustained', confidence: 1, recommendations: ['review-thermal-margin-collapse-without-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes margin states and bounded samples', () => {
    expect(runThermalMarginTurbo([facts(50), facts(50)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-margin' });
    expect(runThermalMarginTurbo([facts(75), facts(80)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'margin-collapse-observed', fallingCount: 1 });
    expect(runThermalMarginTurbo([facts(80), facts(75), facts(70)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'margin-recovery-observed', risingCount: 2 });
    expect(runThermalMarginTurbo([facts(92), facts(92)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'low-margin', finalHeadroomCelsius: 8 });
    expect(runThermalMarginTurbo([facts(100), facts(101)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'critical-margin', finalHeadroomCelsius: -1 });
    expect(runThermalMarginTurbo([facts(50), facts(undefined)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'observation-required', unknownCount: 1 });
    expect(runThermalMarginTurbo([facts(undefined), facts(null)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'margin-unknown', observedCount: 0, confidence: 0 });
    expect(runThermalMarginTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, finalHeadroomCelsius: null, confidence: 0 });
  });
  test('normalizes thermal values and environment', () => {
    expect(runThermalMarginTurbo([facts(120, 100, { environment: 'other' })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalHeadroomCelsius: -20, finalEnvironment: 'unknown', state: 'critical-margin', confidence: 1 });
    expect(runThermalMarginTurbo([facts(-10, 100)], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalTemperatureCelsius: null, finalHeadroomCelsius: null, state: 'margin-unknown' });
  });
  test('rejects invalid triggers, bounds, snapshots, and clocks', () => {
    expect(() => runThermalMarginTurbo([], { trigger: 'bad' })).toThrow('Unsupported thermal thermal-margin trigger: bad');
    expect(() => runThermalMarginTurbo()).toThrow('Unsupported thermal thermal-margin trigger: unknown');
    expect(() => runThermalMarginTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runThermalMarginTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runThermalMarginTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runThermalMarginTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runThermalMarginTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runThermalMarginTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runThermalMarginTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runThermalMarginTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runThermalMarginTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runThermalMarginTurbo([{ engine: 'system-facts', thermal: null }], { trigger: 'health.interval' })).toThrow('requires a thermal object');
    expect(() => runThermalMarginTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
