import { BATTERY_POWER_SOURCE_DRIFT_LIBRARY_ID, BATTERY_POWER_SOURCE_DRIFT_LIBRARY_VERSION,
  buildBatteryPowerSourceDriftEnvelope, buildBatteryPowerSourceDriftPlan, createBatteryPowerSourceDriftLibrary,
  mergeBatteryPowerSourceDriftReports } from '../pc/engines/battery/turbos/power-source-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'battery.power-source-drift', state: 'stable-source', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    observedCount: sampleCount, unknownCount: 0, comparisonCount: Math.max(0, sampleCount - 1), presenceChangeCount: 0, chargingChangeCount: 0,
    finalPresent: true, finalCharging: false, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('battery power-source-drift library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeBatteryPowerSourceDriftReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'source-drift-sustained', presenceChangeCount: 1, chargingChangeCount: 2, finalPresent: true, finalCharging: true, finalEnvironment: 'headless' })]);
    expect(BATTERY_POWER_SOURCE_DRIFT_LIBRARY_ID).toBe('battery.power-source-drift.library'); expect(BATTERY_POWER_SOURCE_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'source-drift-sustained', sampleCount: 6, observedCount: 6, comparisonCount: 4, presenceChangeCount: 1, chargingChangeCount: 2, finalPresent: true, finalCharging: true, finalEnvironment: 'headless', recommendations: ['review-power-source-drift-without-control-change'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeBatteryPowerSourceDriftReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-power-source-samples'] });
    expect(mergeBatteryPowerSourceDriftReports([report({ state: 'source-unknown', observedCount: 0, unknownCount: 4, finalPresent: null, finalCharging: null, confidence: 0 })]).recommendations).toEqual(['request-power-source-observation']);
    expect(mergeBatteryPowerSourceDriftReports([report({ state: 'no-battery', finalPresent: false })]).recommendations).toEqual(['keep-battery-controls-disabled']);
    expect(mergeBatteryPowerSourceDriftReports([report({ state: 'observation-required', observedCount: 2, unknownCount: 2, finalPresent: null, finalCharging: false })]).recommendations).toEqual(['request-complete-power-source-observation']);
    expect(mergeBatteryPowerSourceDriftReports([report({ state: 'source-drift-observed', chargingChangeCount: 1 })]).recommendations).toEqual(['observe-power-source-stability']);
    expect(mergeBatteryPowerSourceDriftReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeBatteryPowerSourceDriftReports([report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, comparisonCount: 0, finalPresent: null, finalCharging: null, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, sampleCount, finalPresent, finalCharging] of [['no-battery', 'empty-observation', 10000, 4, false, false], ['source-drift-sustained', 'source-review', 1000, 4, true, true], ['source-drift-observed', 'source-observation', 1500, 4, true, true], ['observation-required', 'evidence-bootstrap', 2000, 4, null, false], ['source-unknown', 'evidence-bootstrap', 2000, 4, null, null], ['insufficient-data', 'evidence-bootstrap', 2000, 0, null, null], ['stable-source', 'stable-observation', 5000, 4, true, false]]) {
      expect(buildBatteryPowerSourceDriftPlan(report({ state, sampleCount, observedCount: finalPresent === null ? 0 : sampleCount, unknownCount: finalPresent === null ? sampleCount : 0, comparisonCount: Math.max(0, sampleCount - 1), finalPresent, finalCharging, confidence: finalPresent === null ? 0 : 1 }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildBatteryPowerSourceDriftPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildBatteryPowerSourceDriftPlan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0, comparisonCount: 0, finalPresent: null, finalCharging: null, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildBatteryPowerSourceDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createBatteryPowerSourceDriftLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(BATTERY_POWER_SOURCE_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeBatteryPowerSourceDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeBatteryPowerSourceDriftReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeBatteryPowerSourceDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeBatteryPowerSourceDriftReports([report({ turbo: 'other' })])).toThrow('requires a power-source-drift turbo report');
    expect(() => mergeBatteryPowerSourceDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeBatteryPowerSourceDriftReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeBatteryPowerSourceDriftReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeBatteryPowerSourceDriftReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeBatteryPowerSourceDriftReports([report({ observedCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeBatteryPowerSourceDriftReports([report({ finalPresent: 'yes' })])).toThrow('finalPresent must be boolean or null');
    expect(() => mergeBatteryPowerSourceDriftReports([report({ finalCharging: 'yes' })])).toThrow('finalCharging must be boolean or null');
    expect(() => mergeBatteryPowerSourceDriftReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeBatteryPowerSourceDriftReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildBatteryPowerSourceDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildBatteryPowerSourceDriftEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
