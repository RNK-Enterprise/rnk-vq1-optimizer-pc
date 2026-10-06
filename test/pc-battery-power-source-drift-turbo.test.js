import { BATTERY_POWER_SOURCE_DRIFT_TRIGGERS, BATTERY_POWER_SOURCE_DRIFT_TURBO_ID,
  BATTERY_POWER_SOURCE_DRIFT_TURBO_VERSION, runBatteryPowerSourceDriftTurbo } from '../pc/engines/battery/turbos/power-source-drift/turbo.js';

function facts(present, charging, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', battery: { present, charging }, ...overrides };
}
describe('battery power-source-drift turbo', () => {
  test('publishes identity and detects sustained source movement', () => {
    expect(BATTERY_POWER_SOURCE_DRIFT_TURBO_ID).toBe('battery.power-source-drift');
    expect(BATTERY_POWER_SOURCE_DRIFT_TURBO_VERSION).toBe(1); expect(Object.isFrozen(BATTERY_POWER_SOURCE_DRIFT_TRIGGERS)).toBe(true);
    const result = runBatteryPowerSourceDriftTurbo([facts(true, false), facts(true, true), facts(false, false)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: BATTERY_POWER_SOURCE_DRIFT_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      observedCount: 3, unknownCount: 0, comparisonCount: 2, presenceChangeCount: 1, chargingChangeCount: 2,
      finalPresent: false, finalCharging: false, finalEnvironment: 'interactive', state: 'no-battery', confidence: 1,
      recommendations: ['keep-battery-controls-disabled'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes source states and charging movement', () => {
    expect(runBatteryPowerSourceDriftTurbo([facts(true, false), facts(true, false)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-source' });
    expect(runBatteryPowerSourceDriftTurbo([facts(true, false), facts(true, true)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'source-drift-observed', chargingChangeCount: 1 });
    expect(runBatteryPowerSourceDriftTurbo([facts(true, false), facts(true, true), facts(true, false)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'source-drift-sustained', chargingChangeCount: 2 });
    expect(runBatteryPowerSourceDriftTurbo([facts(undefined, undefined), facts(null, null)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'source-unknown', observedCount: 0, confidence: 0 });
    expect(runBatteryPowerSourceDriftTurbo([facts(true, false), facts(undefined, false)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'observation-required', unknownCount: 1 });
    expect(runBatteryPowerSourceDriftTurbo([facts(false, false), facts(false, false)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-battery' });
    expect(runBatteryPowerSourceDriftTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes environment and preserves null controls', () => {
    expect(runBatteryPowerSourceDriftTurbo([facts(true, true, { environment: 'other' })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalEnvironment: 'unknown', finalPresent: true, finalCharging: true, state: 'stable-source', confidence: 1 });
    expect(runBatteryPowerSourceDriftTurbo([facts('yes', 'no')], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalPresent: null, finalCharging: null, state: 'source-unknown' });
  });
  test('rejects invalid triggers, bounds, snapshots, and clocks', () => {
    expect(() => runBatteryPowerSourceDriftTurbo([], { trigger: 'bad' })).toThrow('Unsupported battery power-source-drift trigger: bad');
    expect(() => runBatteryPowerSourceDriftTurbo()).toThrow('Unsupported battery power-source-drift trigger: unknown');
    expect(() => runBatteryPowerSourceDriftTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runBatteryPowerSourceDriftTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runBatteryPowerSourceDriftTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runBatteryPowerSourceDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runBatteryPowerSourceDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runBatteryPowerSourceDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runBatteryPowerSourceDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runBatteryPowerSourceDriftTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runBatteryPowerSourceDriftTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runBatteryPowerSourceDriftTurbo([{ engine: 'system-facts', battery: null }], { trigger: 'health.interval' })).toThrow('requires a battery object');
    expect(() => runBatteryPowerSourceDriftTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
