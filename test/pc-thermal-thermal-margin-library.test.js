import { THERMAL_MARGIN_LIBRARY_ID, THERMAL_MARGIN_LIBRARY_VERSION,
  buildThermalMarginEnvelope, buildThermalMarginPlan, createThermalMarginLibrary,
  mergeThermalMarginReports } from '../pc/engines/thermal/turbos/thermal-margin/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'thermal.thermal-margin', state: 'stable-margin', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    observedCount: sampleCount, unknownCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changedCount: 0, fallingCount: 0, risingCount: 0,
    finalHeadroomCelsius: 45, finalTemperatureCelsius: 55, finalCriticalCelsius: 100, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('thermal thermal-margin library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeThermalMarginReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'margin-collapse-sustained', fallingCount: 2, finalHeadroomCelsius: 25, finalEnvironment: 'headless' })]);
    expect(THERMAL_MARGIN_LIBRARY_ID).toBe('thermal.thermal-margin.library'); expect(THERMAL_MARGIN_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'margin-collapse-sustained', sampleCount: 6, observedCount: 6, unknownCount: 0, comparisonCount: 4, fallingCount: 2, finalHeadroomCelsius: 25, finalEnvironment: 'headless', recommendations: ['review-thermal-margin-collapse-without-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeThermalMarginReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-thermal-margin-samples'] });
    expect(mergeThermalMarginReports([report({ state: 'critical-margin', finalHeadroomCelsius: -1 })]).recommendations).toEqual(['protect-thermal-headroom', 'request-user-approved-thermal-response']);
    expect(mergeThermalMarginReports([report({ state: 'low-margin', finalHeadroomCelsius: 8 })]).recommendations).toEqual(['review-low-thermal-margin']);
    expect(mergeThermalMarginReports([report({ state: 'margin-collapse-observed', fallingCount: 1 })]).recommendations).toEqual(['observe-thermal-margin-stability']);
    expect(mergeThermalMarginReports([report({ state: 'margin-recovery-observed', risingCount: 1 })]).recommendations).toEqual(['observe-thermal-margin-recovery']);
    expect(mergeThermalMarginReports([report({ state: 'observation-required', observedCount: 3, unknownCount: 1, confidence: 0.75 })]).recommendations).toEqual(['request-complete-thermal-margin-observation']);
    expect(mergeThermalMarginReports([report({ state: 'margin-unknown', sampleCount: 2, observedCount: 0, unknownCount: 2, confidence: 0 })]).recommendations).toEqual(['request-thermal-margin-observation']);
    expect(mergeThermalMarginReports([report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeThermalMarginReports([report()])).toMatchObject({ state: 'stable-margin', recommendations: ['no-change'] });
    for (const [state, mode, intervalMs, sampleCount, confidence] of [['critical-margin', 'thermal-protection-review', 500, 4, 1], ['margin-collapse-sustained', 'margin-collapse-review', 750, 4, 1], ['margin-collapse-observed', 'margin-observation', 1000, 4, 1], ['low-margin', 'headroom-review', 1000, 4, 1], ['margin-recovery-observed', 'recovery-observation', 1500, 4, 1], ['observation-required', 'evidence-bootstrap', 2000, 4, 0.75], ['margin-unknown', 'evidence-bootstrap', 2000, 4, 0], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0], ['stable-margin', 'stable-observation', 5000, 4, 1]]) {
      expect(buildThermalMarginPlan(report({ state, sampleCount, observedCount: state === 'margin-unknown' || state === 'insufficient-data' ? 0 : sampleCount, unknownCount: state === 'margin-unknown' ? sampleCount : 0, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildThermalMarginPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildThermalMarginPlan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildThermalMarginEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createThermalMarginLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(THERMAL_MARGIN_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeThermalMarginReports(null)).toThrow('reports must be an array');
    expect(() => mergeThermalMarginReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeThermalMarginReports([null])).toThrow('report must be an object');
    expect(() => mergeThermalMarginReports([report({ turbo: 'other' })])).toThrow('requires a thermal-margin turbo report');
    expect(() => mergeThermalMarginReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeThermalMarginReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeThermalMarginReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeThermalMarginReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeThermalMarginReports([report({ observedCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeThermalMarginReports([report({ finalHeadroomCelsius: 'bad' })])).toThrow('final headroom must be numeric or null');
    expect(() => mergeThermalMarginReports([report({ finalTemperatureCelsius: NaN })])).toThrow('final temperature must be numeric or null');
    expect(() => mergeThermalMarginReports([report({ finalCriticalCelsius: 'bad' })])).toThrow('final critical temperature must be numeric or null');
    expect(() => mergeThermalMarginReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeThermalMarginReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildThermalMarginEnvelope(report())).toThrow('trigger is required');
    expect(() => buildThermalMarginEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
