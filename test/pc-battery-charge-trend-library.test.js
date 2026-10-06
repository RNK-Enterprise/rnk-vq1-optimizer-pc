import { BATTERY_CHARGE_TREND_LIBRARY_ID, BATTERY_CHARGE_TREND_LIBRARY_VERSION,
  buildBatteryChargeTrendEnvelope, buildBatteryChargeTrendPlan, createBatteryChargeTrendLibrary,
  mergeBatteryChargeTrendReports } from '../pc/engines/battery/turbos/charge-trend/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'battery.charge-trend', state: 'stable-charge', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    observedCount: sampleCount, unknownCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changedCount: 0,
    risingCount: 0, fallingCount: 0, finalChargePercent: 60, finalCharging: false, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('battery charge-trend library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeBatteryChargeTrendReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'charge-falling-sustained', fallingCount: 2, changedCount: 2, finalChargePercent: 20, finalEnvironment: 'headless' })]);
    expect(BATTERY_CHARGE_TREND_LIBRARY_ID).toBe('battery.charge-trend.library'); expect(BATTERY_CHARGE_TREND_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'charge-falling-sustained', sampleCount: 6, observedCount: 6, comparisonCount: 4, changedCount: 2, fallingCount: 2, finalChargePercent: 20, finalEnvironment: 'headless', recommendations: ['review-charge-loss-without-charging-change'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeBatteryChargeTrendReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-charge-samples'] });
    expect(mergeBatteryChargeTrendReports([report({ state: 'charge-unknown', observedCount: 0, unknownCount: 4, finalChargePercent: null, confidence: 0 })]).recommendations).toEqual(['request-charge-observation']);
    expect(mergeBatteryChargeTrendReports([report({ state: 'observation-required', observedCount: 2, unknownCount: 2, finalChargePercent: null })]).recommendations).toEqual(['request-complete-charge-observation']);
    expect(mergeBatteryChargeTrendReports([report({ state: 'low-charge', finalChargePercent: 10 })]).recommendations).toEqual(['review-user-owned-power-policy']);
    expect(mergeBatteryChargeTrendReports([report({ state: 'charge-rising-sustained', risingCount: 2 })]).recommendations).toEqual(['observe-charge-recovery']);
    expect(mergeBatteryChargeTrendReports([report({ state: 'charge-drift-observed', risingCount: 1, changedCount: 1 })]).recommendations).toEqual(['observe-charge-stability']);
    expect(mergeBatteryChargeTrendReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeBatteryChargeTrendReports([report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, comparisonCount: 0, finalChargePercent: null, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, sampleCount, finalChargePercent] of [['low-charge', 'power-review', 750, 4, 10], ['charge-falling-sustained', 'charge-loss-review', 1000, 4, 20], ['charge-rising-sustained', 'recovery-observation', 1500, 4, 70], ['charge-drift-observed', 'trend-observation', 2000, 4, 50], ['observation-required', 'evidence-bootstrap', 2000, 4, null], ['charge-unknown', 'sample-bootstrap', 2000, 4, null], ['insufficient-data', 'sample-bootstrap', 2000, 0, null], ['stable-charge', 'stable-observation', 5000, 4, 60]]) {
      expect(buildBatteryChargeTrendPlan(report({ state, sampleCount, observedCount: finalChargePercent === null ? 0 : sampleCount, unknownCount: finalChargePercent === null ? sampleCount : 0, comparisonCount: Math.max(0, sampleCount - 1), finalChargePercent, confidence: finalChargePercent === null ? 0 : 1 }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildBatteryChargeTrendPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildBatteryChargeTrendPlan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0, comparisonCount: 0, finalChargePercent: null, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildBatteryChargeTrendEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createBatteryChargeTrendLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(BATTERY_CHARGE_TREND_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeBatteryChargeTrendReports(null)).toThrow('reports must be an array');
    expect(() => mergeBatteryChargeTrendReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeBatteryChargeTrendReports([null])).toThrow('report must be an object');
    expect(() => mergeBatteryChargeTrendReports([report({ turbo: 'other' })])).toThrow('requires a charge-trend turbo report');
    expect(() => mergeBatteryChargeTrendReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeBatteryChargeTrendReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeBatteryChargeTrendReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeBatteryChargeTrendReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeBatteryChargeTrendReports([report({ observedCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeBatteryChargeTrendReports([report({ finalChargePercent: 'bad' })])).toThrow('numeric or null');
    expect(() => mergeBatteryChargeTrendReports([report({ finalChargePercent: 101 })])).toThrow('between 0 and 100');
    expect(() => mergeBatteryChargeTrendReports([report({ finalCharging: 'yes' })])).toThrow('boolean or null');
    expect(() => mergeBatteryChargeTrendReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeBatteryChargeTrendReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildBatteryChargeTrendEnvelope(report())).toThrow('trigger is required');
    expect(() => buildBatteryChargeTrendEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
