import { THERMAL_SENSOR_STABILITY_LIBRARY_ID, THERMAL_SENSOR_STABILITY_LIBRARY_VERSION,
  buildThermalSensorStabilityEnvelope, buildThermalSensorStabilityPlan, createThermalSensorStabilityLibrary,
  mergeThermalSensorStabilityReports } from '../pc/engines/thermal/turbos/sensor-stability/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'thermal.sensor-stability', state: 'stable-sensor', sampleCount, minimumSamples: 2, jitterThreshold: 5, persistenceThreshold: 2,
    observedCount: sampleCount, completeCount: sampleCount, unknownCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changedCount: 0, jitterCount: 0,
    finalTemperatureCelsius: 55, finalFanPercent: 40, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('thermal sensor-stability library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeThermalSensorStabilityReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'sensor-jitter-sustained', jitterCount: 2, finalTemperatureCelsius: 70, finalEnvironment: 'headless' })]);
    expect(THERMAL_SENSOR_STABILITY_LIBRARY_ID).toBe('thermal.sensor-stability.library'); expect(THERMAL_SENSOR_STABILITY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'sensor-jitter-sustained', sampleCount: 6, observedCount: 6, completeCount: 6, unknownCount: 0, comparisonCount: 4, jitterCount: 2, jitterThreshold: 5, finalTemperatureCelsius: 70, finalEnvironment: 'headless', recommendations: ['review-thermal-sensor-jitter-without-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeThermalSensorStabilityReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-thermal-sensor-samples'] });
    expect(mergeThermalSensorStabilityReports([report({ state: 'sensor-jitter-observed', jitterCount: 1 })]).recommendations).toEqual(['observe-thermal-sensor-stability']);
    expect(mergeThermalSensorStabilityReports([report({ state: 'sensor-evidence-required', completeCount: 3, confidence: 0.75 })]).recommendations).toEqual(['request-complete-thermal-sensor-evidence']);
    expect(mergeThermalSensorStabilityReports([report({ state: 'sensor-unknown', sampleCount: 2, observedCount: 0, completeCount: 0, unknownCount: 2, confidence: 0 })]).recommendations).toEqual(['request-thermal-sensor-observation']);
    expect(mergeThermalSensorStabilityReports([report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, completeCount: 0, unknownCount: 1, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeThermalSensorStabilityReports([report()])).toMatchObject({ state: 'stable-sensor', recommendations: ['no-change'] });
    for (const [state, mode, intervalMs, sampleCount, confidence] of [['sensor-jitter-sustained', 'sensor-jitter-review', 750, 4, 1], ['sensor-jitter-observed', 'sensor-jitter-observation', 1250, 4, 1], ['sensor-evidence-required', 'evidence-bootstrap', 2000, 4, 0.75], ['sensor-unknown', 'evidence-bootstrap', 2000, 4, 0], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0], ['stable-sensor', 'stable-observation', 5000, 4, 1]]) {
      expect(buildThermalSensorStabilityPlan(report({ state, sampleCount, observedCount: state === 'sensor-unknown' || state === 'insufficient-data' ? 0 : sampleCount, completeCount: state === 'sensor-evidence-required' ? sampleCount - 1 : state === 'sensor-unknown' || state === 'insufficient-data' ? 0 : sampleCount, unknownCount: state === 'sensor-unknown' ? sampleCount : 0, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildThermalSensorStabilityPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildThermalSensorStabilityPlan(report({ sampleCount: 0, observedCount: 0, completeCount: 0, unknownCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildThermalSensorStabilityEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createThermalSensorStabilityLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(THERMAL_SENSOR_STABILITY_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeThermalSensorStabilityReports(null)).toThrow('reports must be an array');
    expect(() => mergeThermalSensorStabilityReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeThermalSensorStabilityReports([null])).toThrow('report must be an object');
    expect(() => mergeThermalSensorStabilityReports([report({ turbo: 'other' })])).toThrow('requires a sensor-stability turbo report');
    expect(() => mergeThermalSensorStabilityReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeThermalSensorStabilityReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeThermalSensorStabilityReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeThermalSensorStabilityReports([report({ jitterThreshold: 0 })])).toThrow('jitterThreshold must be from 0.1 to 50');
    expect(() => mergeThermalSensorStabilityReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeThermalSensorStabilityReports([report({ observedCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeThermalSensorStabilityReports([report({ finalTemperatureCelsius: 'bad' })])).toThrow('final temperature must be numeric or null');
    expect(() => mergeThermalSensorStabilityReports([report({ finalFanPercent: 'bad' })])).toThrow('final fan percent must be numeric or null');
    expect(() => mergeThermalSensorStabilityReports([report({ finalFanPercent: 101 })])).toThrow('final fan percent must be between 0 and 100');
    expect(() => mergeThermalSensorStabilityReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeThermalSensorStabilityReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildThermalSensorStabilityEnvelope(report())).toThrow('trigger is required');
    expect(() => buildThermalSensorStabilityEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
