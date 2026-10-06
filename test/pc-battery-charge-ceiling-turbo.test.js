import { BATTERY_CHARGE_CEILING_TRIGGERS, BATTERY_CHARGE_CEILING_TURBO_ID,
  BATTERY_CHARGE_CEILING_TURBO_VERSION, runBatteryChargeCeilingTurbo } from '../pc/engines/battery/turbos/charge-ceiling/turbo.js';

function facts(chargePercent, charging = false, present = true, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', battery: { chargePercent, charging, present }, ...overrides };
}
describe('battery charge-ceiling turbo', () => {
  test('publishes identity and detects a held ceiling', () => {
    expect(BATTERY_CHARGE_CEILING_TURBO_ID).toBe('battery.charge-ceiling');
    expect(BATTERY_CHARGE_CEILING_TURBO_VERSION).toBe(1); expect(Object.isFrozen(BATTERY_CHARGE_CEILING_TRIGGERS)).toBe(true);
    const result = runBatteryChargeCeilingTurbo([facts(95, true), facts(96, true), facts(97, true)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: BATTERY_CHARGE_CEILING_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      observedCount: 3, unknownCount: 0, comparisonCount: 2, ceilingPercent: 95, movementThreshold: 5, ceilingCount: 3, movementCount: 0,
      finalChargePercent: 97, finalPresent: true, finalCharging: true, finalEnvironment: 'interactive', state: 'ceiling-held', confidence: 1,
      recommendations: ['review-ceiling-evidence-without-limit-change'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes ceiling, movement, and evidence states', () => {
    expect(runBatteryChargeCeilingTurbo([facts(80), facts(80)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-ceiling' });
    expect(runBatteryChargeCeilingTurbo([facts(90), facts(96)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'ceiling-observed', ceilingCount: 1 });
    expect(runBatteryChargeCeilingTurbo([facts(40), facts(50), facts(60)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'charge-movement-sustained', movementCount: 2 });
    expect(runBatteryChargeCeilingTurbo([facts(40), facts(43)], { trigger: 'health.interval', movementThreshold: 3, now: () => 0 })).toMatchObject({ state: 'charge-movement-observed', movementCount: 1 });
    expect(runBatteryChargeCeilingTurbo([facts(undefined), facts(null)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'ceiling-unknown', observedCount: 0, confidence: 0 });
    expect(runBatteryChargeCeilingTurbo([facts(50), facts(undefined)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'observation-required', unknownCount: 1 });
    expect(runBatteryChargeCeilingTurbo([facts(50, false, false), facts(50, false, false)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-battery' });
    expect(runBatteryChargeCeilingTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes charge and environment evidence', () => {
    expect(runBatteryChargeCeilingTurbo([facts(120, true, true, { environment: 'other' })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalChargePercent: 100, finalEnvironment: 'unknown', state: 'ceiling-observed', confidence: 1 });
    expect(runBatteryChargeCeilingTurbo([facts(-10, true)], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalChargePercent: 0, state: 'stable-ceiling' });
    expect(runBatteryChargeCeilingTurbo([facts(50, 'yes', 'yes')], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalCharging: null, finalPresent: null, state: 'ceiling-unknown' });
  });
  test('rejects invalid triggers, bounds, snapshots, and clocks', () => {
    expect(() => runBatteryChargeCeilingTurbo([], { trigger: 'bad' })).toThrow('Unsupported battery charge-ceiling trigger: bad');
    expect(() => runBatteryChargeCeilingTurbo()).toThrow('Unsupported battery charge-ceiling trigger: unknown');
    expect(() => runBatteryChargeCeilingTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runBatteryChargeCeilingTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runBatteryChargeCeilingTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runBatteryChargeCeilingTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runBatteryChargeCeilingTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runBatteryChargeCeilingTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runBatteryChargeCeilingTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runBatteryChargeCeilingTurbo([], { trigger: 'health.interval', ceilingPercent: 49 })).toThrow('ceilingPercent must be an integer from 50 to 100');
    expect(() => runBatteryChargeCeilingTurbo([], { trigger: 'health.interval', ceilingPercent: 101 })).toThrow('ceilingPercent must be an integer from 50 to 100');
    expect(() => runBatteryChargeCeilingTurbo([], { trigger: 'health.interval', movementThreshold: 0 })).toThrow('movementThreshold must be an integer from 1 to 50');
    expect(() => runBatteryChargeCeilingTurbo([], { trigger: 'health.interval', movementThreshold: 51 })).toThrow('movementThreshold must be an integer from 1 to 50');
    expect(() => runBatteryChargeCeilingTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runBatteryChargeCeilingTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runBatteryChargeCeilingTurbo([{ engine: 'system-facts', battery: null }], { trigger: 'health.interval' })).toThrow('requires a battery object');
    expect(() => runBatteryChargeCeilingTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
