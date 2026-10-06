import { BATTERY_HEALTH_BOUNDARY_LIBRARY_ID, BATTERY_HEALTH_BOUNDARY_LIBRARY_VERSION,
  buildBatteryHealthBoundaryEnvelope, buildBatteryHealthBoundaryPlan, createBatteryHealthBoundaryLibrary,
  mergeBatteryHealthBoundaryReports } from '../pc/engines/battery/turbos/health-boundary/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'battery.health-boundary', state: 'stable-health', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    observedCount: sampleCount, unknownCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changedCount: 0, degradationCount: 0,
    finalHealth: 'healthy', finalPresent: true, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('battery health-boundary library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeBatteryHealthBoundaryReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'health-degradation-sustained', degradationCount: 2, changedCount: 2, finalHealth: 'degraded', finalEnvironment: 'headless' })]);
    expect(BATTERY_HEALTH_BOUNDARY_LIBRARY_ID).toBe('battery.health-boundary.library'); expect(BATTERY_HEALTH_BOUNDARY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'health-degradation-sustained', sampleCount: 6, observedCount: 6, comparisonCount: 4, changedCount: 2, degradationCount: 2, finalHealth: 'degraded', finalEnvironment: 'headless', recommendations: ['review-battery-health-without-policy-change'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeBatteryHealthBoundaryReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-health-samples'] });
    expect(mergeBatteryHealthBoundaryReports([report({ state: 'no-battery', finalHealth: 'unknown', finalPresent: false })]).recommendations).toEqual(['keep-battery-controls-disabled']);
    expect(mergeBatteryHealthBoundaryReports([report({ state: 'health-unknown', observedCount: 0, unknownCount: 4, finalHealth: 'unknown', finalPresent: null, confidence: 0 })]).recommendations).toEqual(['request-health-observation']);
    expect(mergeBatteryHealthBoundaryReports([report({ state: 'observation-required', observedCount: 2, unknownCount: 2, finalHealth: 'unknown', finalPresent: true })]).recommendations).toEqual(['request-complete-health-observation']);
    expect(mergeBatteryHealthBoundaryReports([report({ state: 'protect-health', finalHealth: 'failed' })]).recommendations).toEqual(['protect-power', 'request-user-approved-battery-review']);
    expect(mergeBatteryHealthBoundaryReports([report({ state: 'health-drift-observed', changedCount: 1 })]).recommendations).toEqual(['observe-health-stability']);
    expect(mergeBatteryHealthBoundaryReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeBatteryHealthBoundaryReports([report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, comparisonCount: 0, finalHealth: 'unknown', finalPresent: null, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, sampleCount, finalHealth, finalPresent] of [['protect-health', 'health-protection', 500, 4, 'failed', true], ['no-battery', 'empty-observation', 10000, 4, 'unknown', false], ['health-degradation-sustained', 'health-review', 1000, 4, 'degraded', true], ['health-drift-observed', 'health-observation', 1500, 4, 'degraded', true], ['observation-required', 'evidence-bootstrap', 2000, 4, 'unknown', true], ['health-unknown', 'sample-bootstrap', 2000, 4, 'unknown', null], ['insufficient-data', 'sample-bootstrap', 2000, 0, 'unknown', null], ['stable-health', 'stable-observation', 5000, 4, 'healthy', true]]) {
      expect(buildBatteryHealthBoundaryPlan(report({ state, sampleCount, observedCount: finalHealth === 'unknown' ? 0 : sampleCount, unknownCount: finalHealth === 'unknown' ? sampleCount : 0, comparisonCount: Math.max(0, sampleCount - 1), finalHealth, finalPresent, confidence: finalHealth === 'unknown' ? 0 : 1 }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildBatteryHealthBoundaryPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildBatteryHealthBoundaryPlan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0, comparisonCount: 0, finalHealth: 'unknown', finalPresent: null, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildBatteryHealthBoundaryEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createBatteryHealthBoundaryLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(BATTERY_HEALTH_BOUNDARY_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeBatteryHealthBoundaryReports(null)).toThrow('reports must be an array');
    expect(() => mergeBatteryHealthBoundaryReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeBatteryHealthBoundaryReports([null])).toThrow('report must be an object');
    expect(() => mergeBatteryHealthBoundaryReports([report({ turbo: 'other' })])).toThrow('requires a health-boundary turbo report');
    expect(() => mergeBatteryHealthBoundaryReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeBatteryHealthBoundaryReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeBatteryHealthBoundaryReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeBatteryHealthBoundaryReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeBatteryHealthBoundaryReports([report({ observedCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeBatteryHealthBoundaryReports([report({ finalHealth: 'other' })])).toThrow('finalHealth must be normalized');
    expect(() => mergeBatteryHealthBoundaryReports([report({ finalPresent: 'yes' })])).toThrow('finalPresent must be boolean or null');
    expect(() => mergeBatteryHealthBoundaryReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeBatteryHealthBoundaryReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildBatteryHealthBoundaryEnvelope(report())).toThrow('trigger is required');
    expect(() => buildBatteryHealthBoundaryEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
