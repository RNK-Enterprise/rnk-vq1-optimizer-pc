import { BATTERY_CHARGE_CEILING_LIBRARY_ID, BATTERY_CHARGE_CEILING_LIBRARY_VERSION,
  buildBatteryChargeCeilingEnvelope, buildBatteryChargeCeilingPlan, createBatteryChargeCeilingLibrary,
  mergeBatteryChargeCeilingReports } from '../pc/engines/battery/turbos/charge-ceiling/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'battery.charge-ceiling', state: 'stable-ceiling', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    ceilingPercent: 95, movementThreshold: 5, observedCount: sampleCount, unknownCount: 0, comparisonCount: Math.max(0, sampleCount - 1),
    ceilingCount: 0, movementCount: 0, finalChargePercent: 60, finalPresent: true, finalCharging: false, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('battery charge-ceiling library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeBatteryChargeCeilingReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'ceiling-held', ceilingCount: 4, finalChargePercent: 98, finalEnvironment: 'headless' })]);
    expect(BATTERY_CHARGE_CEILING_LIBRARY_ID).toBe('battery.charge-ceiling.library'); expect(BATTERY_CHARGE_CEILING_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'ceiling-held', sampleCount: 6, observedCount: 6, comparisonCount: 4, ceilingCount: 4, ceilingPercent: 95, finalChargePercent: 98, finalEnvironment: 'headless', recommendations: ['review-ceiling-evidence-without-limit-change'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeBatteryChargeCeilingReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-ceiling-samples'] });
    expect(mergeBatteryChargeCeilingReports([report({ state: 'no-battery', finalPresent: false })]).recommendations).toEqual(['keep-battery-controls-disabled']);
    expect(mergeBatteryChargeCeilingReports([report({ state: 'ceiling-unknown', observedCount: 0, unknownCount: 4, finalChargePercent: null, finalPresent: null, finalCharging: null, confidence: 0 })]).recommendations).toEqual(['request-ceiling-observation']);
    expect(mergeBatteryChargeCeilingReports([report({ state: 'observation-required', observedCount: 2, unknownCount: 2, finalChargePercent: null, finalCharging: null })]).recommendations).toEqual(['request-complete-ceiling-observation']);
    expect(mergeBatteryChargeCeilingReports([report({ state: 'ceiling-observed', ceilingCount: 1, finalChargePercent: 96 })]).recommendations).toEqual(['observe-charge-ceiling']);
    expect(mergeBatteryChargeCeilingReports([report({ state: 'charge-movement-sustained', movementCount: 2 })]).recommendations).toEqual(['review-charge-movement-without-control-change']);
    expect(mergeBatteryChargeCeilingReports([report({ state: 'charge-movement-observed', movementCount: 1 })]).recommendations).toEqual(['observe-charge-movement']);
    expect(mergeBatteryChargeCeilingReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeBatteryChargeCeilingReports([report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, comparisonCount: 0, finalChargePercent: null, finalPresent: null, finalCharging: null, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, sampleCount, finalChargePercent, finalPresent, finalCharging] of [['no-battery', 'empty-observation', 10000, 4, null, false, false], ['ceiling-held', 'ceiling-review', 750, 4, 98, true, true], ['ceiling-observed', 'ceiling-observation', 1500, 4, 96, true, true], ['charge-movement-sustained', 'movement-review', 1000, 4, 60, true, false], ['charge-movement-observed', 'movement-observation', 1500, 4, 60, true, false], ['observation-required', 'evidence-bootstrap', 2000, 4, null, true, null], ['ceiling-unknown', 'evidence-bootstrap', 2000, 4, null, null, null], ['insufficient-data', 'evidence-bootstrap', 2000, 0, null, null, null], ['stable-ceiling', 'stable-observation', 5000, 4, 60, true, false]]) {
      expect(buildBatteryChargeCeilingPlan(report({ state, sampleCount, observedCount: finalChargePercent === null ? 0 : sampleCount, unknownCount: finalChargePercent === null ? sampleCount : 0, comparisonCount: Math.max(0, sampleCount - 1), finalChargePercent, finalPresent, finalCharging, confidence: finalChargePercent === null ? 0 : 1 }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildBatteryChargeCeilingPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildBatteryChargeCeilingPlan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0, comparisonCount: 0, finalChargePercent: null, finalPresent: null, finalCharging: null, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildBatteryChargeCeilingEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createBatteryChargeCeilingLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(BATTERY_CHARGE_CEILING_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeBatteryChargeCeilingReports(null)).toThrow('reports must be an array');
    expect(() => mergeBatteryChargeCeilingReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeBatteryChargeCeilingReports([null])).toThrow('report must be an object');
    expect(() => mergeBatteryChargeCeilingReports([report({ turbo: 'other' })])).toThrow('requires a charge-ceiling turbo report');
    expect(() => mergeBatteryChargeCeilingReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeBatteryChargeCeilingReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeBatteryChargeCeilingReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeBatteryChargeCeilingReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeBatteryChargeCeilingReports([report({ ceilingPercent: 49 })])).toThrow('ceilingPercent must be from 50 to 100');
    expect(() => mergeBatteryChargeCeilingReports([report({ movementThreshold: 51 })])).toThrow('movementThreshold must be from 1 to 50');
    expect(() => mergeBatteryChargeCeilingReports([report({ observedCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeBatteryChargeCeilingReports([report({ finalChargePercent: 'bad' })])).toThrow('numeric or null');
    expect(() => mergeBatteryChargeCeilingReports([report({ finalChargePercent: 101 })])).toThrow('between 0 and 100');
    expect(() => mergeBatteryChargeCeilingReports([report({ finalPresent: 'yes' })])).toThrow('finalPresent must be boolean or null');
    expect(() => mergeBatteryChargeCeilingReports([report({ finalCharging: 'yes' })])).toThrow('finalCharging must be boolean or null');
    expect(() => mergeBatteryChargeCeilingReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeBatteryChargeCeilingReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildBatteryChargeCeilingEnvelope(report())).toThrow('trigger is required');
    expect(() => buildBatteryChargeCeilingEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
