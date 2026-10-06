import { BATTERY_CHARGE_TREND_TRIGGERS, BATTERY_CHARGE_TREND_TURBO_ID,
  BATTERY_CHARGE_TREND_TURBO_VERSION, runBatteryChargeTrendTurbo } from '../pc/engines/battery/turbos/charge-trend/turbo.js';

function facts(chargePercent, charging = false, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', battery: { chargePercent, charging }, ...overrides };
}
describe('battery charge-trend turbo', () => {
  test('publishes identity and detects sustained falling charge', () => {
    expect(BATTERY_CHARGE_TREND_TURBO_ID).toBe('battery.charge-trend');
    expect(BATTERY_CHARGE_TREND_TURBO_VERSION).toBe(1); expect(Object.isFrozen(BATTERY_CHARGE_TREND_TRIGGERS)).toBe(true);
    const result = runBatteryChargeTrendTurbo([facts(80), facts(70), facts(60)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: BATTERY_CHARGE_TREND_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      observedCount: 3, unknownCount: 0, comparisonCount: 2, changedCount: 2, risingCount: 0, fallingCount: 2,
      finalChargePercent: 60, finalCharging: false, finalEnvironment: 'interactive', state: 'charge-falling-sustained',
      confidence: 1, recommendations: ['review-charge-loss-without-charging-change'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes charge states and bounded samples', () => {
    expect(runBatteryChargeTrendTurbo([facts(50), facts(50)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-charge' });
    expect(runBatteryChargeTrendTurbo([facts(40), facts(50)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'charge-drift-observed', risingCount: 1 });
    expect(runBatteryChargeTrendTurbo([facts(40), facts(50), facts(60)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'charge-rising-sustained', risingCount: 2 });
    expect(runBatteryChargeTrendTurbo([facts(15), facts(10)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'low-charge', finalChargePercent: 10 });
    expect(runBatteryChargeTrendTurbo([facts(50), facts(undefined)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'observation-required', unknownCount: 1 });
    expect(runBatteryChargeTrendTurbo([facts(undefined), facts(null)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'charge-unknown', observedCount: 0, confidence: 0 });
    expect(runBatteryChargeTrendTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, finalChargePercent: null, confidence: 0 });
  });
  test('normalizes charge, charging, and environment evidence', () => {
    expect(runBatteryChargeTrendTurbo([facts(120, 'yes', { environment: 'other' })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalChargePercent: 100, finalCharging: null, finalEnvironment: 'unknown', state: 'stable-charge', confidence: 1 });
    expect(runBatteryChargeTrendTurbo([facts(-10, true)], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalChargePercent: 0, state: 'low-charge' });
  });
  test('rejects invalid triggers, bounds, snapshots, and clocks', () => {
    expect(() => runBatteryChargeTrendTurbo([], { trigger: 'bad' })).toThrow('Unsupported battery charge-trend trigger: bad');
    expect(() => runBatteryChargeTrendTurbo()).toThrow('Unsupported battery charge-trend trigger: unknown');
    expect(() => runBatteryChargeTrendTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runBatteryChargeTrendTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runBatteryChargeTrendTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runBatteryChargeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runBatteryChargeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runBatteryChargeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runBatteryChargeTrendTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runBatteryChargeTrendTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runBatteryChargeTrendTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runBatteryChargeTrendTurbo([{ engine: 'system-facts', battery: null }], { trigger: 'health.interval' })).toThrow('requires a battery object');
    expect(() => runBatteryChargeTrendTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
