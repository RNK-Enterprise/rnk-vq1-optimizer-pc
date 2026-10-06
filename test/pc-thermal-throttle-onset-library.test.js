import { THERMAL_THROTTLE_ONSET_LIBRARY_ID, THERMAL_THROTTLE_ONSET_LIBRARY_VERSION,
  buildThermalThrottleOnsetEnvelope, buildThermalThrottleOnsetPlan, createThermalThrottleOnsetLibrary,
  mergeThermalThrottleOnsetReports } from '../pc/engines/thermal/turbos/throttle-onset/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'thermal.throttle-onset', state: 'below-threshold', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    observedCount: sampleCount, unknownCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changedCount: 0, crossingCount: 0, riskCount: 0,
    finalRatioPercent: 50, finalBand: 'below-threshold', finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('thermal throttle-onset library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeThermalThrottleOnsetReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'throttle-risk-sustained', crossingCount: 2, riskCount: 2, finalRatioPercent: 95, finalBand: 'throttle-risk', finalEnvironment: 'headless' })]);
    expect(THERMAL_THROTTLE_ONSET_LIBRARY_ID).toBe('thermal.throttle-onset.library'); expect(THERMAL_THROTTLE_ONSET_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'throttle-risk-sustained', sampleCount: 6, observedCount: 6, unknownCount: 0, comparisonCount: 4, crossingCount: 2, riskCount: 2, finalRatioPercent: 95, finalBand: 'throttle-risk', finalEnvironment: 'headless', recommendations: ['review-throttle-risk-without-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeThermalThrottleOnsetReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-throttle-onset-samples'] });
    expect(mergeThermalThrottleOnsetReports([report({ state: 'critical-threshold', finalRatioPercent: 100, finalBand: 'critical-threshold' })]).recommendations).toEqual(['protect-critical-thermal-threshold', 'request-user-approved-thermal-response']);
    expect(mergeThermalThrottleOnsetReports([report({ state: 'throttle-risk', riskCount: 1, finalRatioPercent: 95, finalBand: 'throttle-risk' })]).recommendations).toEqual(['observe-throttle-onset']);
    expect(mergeThermalThrottleOnsetReports([report({ state: 'watch-threshold', finalRatioPercent: 80, finalBand: 'watch-threshold' })]).recommendations).toEqual(['observe-thermal-threshold']);
    expect(mergeThermalThrottleOnsetReports([report({ state: 'threshold-crossing-sustained', crossingCount: 2 })]).recommendations).toEqual(['review-thermal-threshold-churn']);
    expect(mergeThermalThrottleOnsetReports([report({ state: 'threshold-crossing-observed', crossingCount: 1 })]).recommendations).toEqual(['observe-thermal-threshold-stability']);
    expect(mergeThermalThrottleOnsetReports([report({ state: 'observation-required', observedCount: 3, unknownCount: 1, confidence: 0.75 })]).recommendations).toEqual(['request-complete-throttle-onset-observation']);
    expect(mergeThermalThrottleOnsetReports([report({ state: 'threshold-unknown', sampleCount: 2, observedCount: 0, unknownCount: 2, confidence: 0, finalRatioPercent: null, finalBand: 'unknown' })]).recommendations).toEqual(['request-throttle-onset-observation']);
    expect(mergeThermalThrottleOnsetReports([report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, comparisonCount: 0, confidence: 0, finalRatioPercent: null, finalBand: 'unknown' })]).state).toBe('insufficient-data');
    expect(mergeThermalThrottleOnsetReports([report()])).toMatchObject({ state: 'below-threshold', recommendations: ['no-change'] });
    for (const [state, mode, intervalMs, sampleCount, confidence] of [['critical-threshold', 'critical-threshold-review', 500, 4, 1], ['throttle-risk-sustained', 'throttle-risk-review', 750, 4, 1], ['throttle-risk', 'throttle-observation', 1000, 4, 1], ['watch-threshold', 'threshold-observation', 1000, 4, 1], ['threshold-crossing-sustained', 'threshold-churn-review', 1250, 4, 1], ['threshold-crossing-observed', 'threshold-churn-observation', 1500, 4, 1], ['observation-required', 'evidence-bootstrap', 2000, 4, 0.75], ['threshold-unknown', 'evidence-bootstrap', 2000, 4, 0], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0], ['below-threshold', 'stable-observation', 5000, 4, 1]]) {
      expect(buildThermalThrottleOnsetPlan(report({ state, sampleCount, observedCount: state === 'threshold-unknown' || state === 'insufficient-data' ? 0 : sampleCount, unknownCount: state === 'threshold-unknown' ? sampleCount : 0, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildThermalThrottleOnsetPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildThermalThrottleOnsetPlan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0, comparisonCount: 0, confidence: 0, finalRatioPercent: null, finalBand: 'unknown' }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildThermalThrottleOnsetEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createThermalThrottleOnsetLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(THERMAL_THROTTLE_ONSET_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeThermalThrottleOnsetReports(null)).toThrow('reports must be an array');
    expect(() => mergeThermalThrottleOnsetReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeThermalThrottleOnsetReports([null])).toThrow('report must be an object');
    expect(() => mergeThermalThrottleOnsetReports([report({ turbo: 'other' })])).toThrow('requires a throttle-onset turbo report');
    expect(() => mergeThermalThrottleOnsetReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeThermalThrottleOnsetReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeThermalThrottleOnsetReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeThermalThrottleOnsetReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeThermalThrottleOnsetReports([report({ observedCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeThermalThrottleOnsetReports([report({ finalRatioPercent: 'bad' })])).toThrow('finalRatioPercent must be numeric or null');
    expect(() => mergeThermalThrottleOnsetReports([report({ finalRatioPercent: -1 })])).toThrow('finalRatioPercent must be non-negative');
    expect(() => mergeThermalThrottleOnsetReports([report({ finalBand: 'other' })])).toThrow('finalBand must be normalized');
    expect(() => mergeThermalThrottleOnsetReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeThermalThrottleOnsetReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildThermalThrottleOnsetEnvelope(report())).toThrow('trigger is required');
    expect(() => buildThermalThrottleOnsetEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
