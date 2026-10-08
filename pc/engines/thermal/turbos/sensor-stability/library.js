/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated sensor-stability library. It validates jitter evidence and builds
 * observation plans without importing sensor or thermal control APIs.
 */
export const THERMAL_SENSOR_STABILITY_LIBRARY_ID = 'thermal.sensor-stability.library';
export const THERMAL_SENSOR_STABILITY_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-sensor', 'sensor-jitter-observed', 'sensor-jitter-sustained', 'sensor-evidence-required', 'sensor-unknown', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Sensor-stability library report must be an object');
  if (report.turbo !== 'thermal.sensor-stability') throw new Error('Sensor-stability library requires a sensor-stability turbo report');
  if (!STATES.includes(report.state)) throw new Error('Sensor-stability library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Sensor-stability library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Sensor-stability library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Sensor-stability library persistenceThreshold must be from 1 to 64');
  if (!Number.isFinite(report.jitterThreshold) || report.jitterThreshold < 0.1 || report.jitterThreshold > 50) throw new RangeError('Sensor-stability library jitterThreshold must be from 0.1 to 50');
  for (const [field, label] of [['observedCount', 'observed count'], ['completeCount', 'complete count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['changedCount', 'changed count'], ['jitterCount', 'jitter count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Sensor-stability library ${label} must be from 0 to 4096`);
  }
  if (!Number.isFinite(report.finalTemperatureCelsius) && report.finalTemperatureCelsius !== null) throw new TypeError('Sensor-stability library final temperature must be numeric or null');
  if (!Number.isFinite(report.finalFanPercent) && report.finalFanPercent !== null) throw new TypeError('Sensor-stability library final fan percent must be numeric or null');
  if (report.finalFanPercent !== null && (report.finalFanPercent < 0 || report.finalFanPercent > 100)) throw new RangeError('Sensor-stability library final fan percent must be between 0 and 100');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Sensor-stability library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Sensor-stability library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Sensor-stability library reports must be an array');
  if (reports.length > 64) throw new RangeError('Sensor-stability library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'sensor-jitter-sustained')) return 'sensor-jitter-sustained';
  if (reports.some((report) => report.state === 'sensor-jitter-observed')) return 'sensor-jitter-observed';
  if (reports.some((report) => report.state === 'sensor-evidence-required')) return 'sensor-evidence-required';
  if (reports.every((report) => report.state === 'sensor-unknown')) return 'sensor-unknown';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-sensor';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-thermal-sensor-samples']);
  if (state === 'sensor-unknown') return Object.freeze(['request-thermal-sensor-observation']);
  if (state === 'sensor-evidence-required') return Object.freeze(['request-complete-thermal-sensor-evidence']);
  if (state === 'sensor-jitter-sustained') return Object.freeze(['review-thermal-sensor-jitter-without-mutation']);
  if (state === 'sensor-jitter-observed') return Object.freeze(['observe-thermal-sensor-stability']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'sensor-jitter-sustained') return 'sensor-jitter-review';
  if (state === 'sensor-jitter-observed') return 'sensor-jitter-observation';
  if (state === 'sensor-evidence-required' || state === 'sensor-unknown' || state === 'insufficient-data') return 'evidence-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'sensor-jitter-sustained') return 750;
  if (state === 'sensor-jitter-observed') return 1250;
  if (state === 'sensor-evidence-required' || state === 'sensor-unknown' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeThermalSensorStabilityReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: THERMAL_SENSOR_STABILITY_LIBRARY_ID, libraryVersion: THERMAL_SENSOR_STABILITY_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), completeCount: validated.reduce((sum, report) => sum + report.completeCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0), comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changedCount: validated.reduce((sum, report) => sum + report.changedCount, 0), jitterCount: validated.reduce((sum, report) => sum + report.jitterCount, 0),
    jitterThreshold: latest?.jitterThreshold || 0, finalTemperatureCelsius: latest?.finalTemperatureCelsius ?? null,
    finalFanPercent: latest?.finalFanPercent ?? null, finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0,
    recommendations: recommendations(state) });
}
export function buildThermalSensorStabilityPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: THERMAL_SENSOR_STABILITY_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Sensor-stability library clock must return a number'); return timestamp; }
export function buildThermalSensorStabilityEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Sensor-stability library trigger is required');
  return Object.freeze({ library: THERMAL_SENSOR_STABILITY_LIBRARY_ID, libraryVersion: THERMAL_SENSOR_STABILITY_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createThermalSensorStabilityLibrary() {
  return Object.freeze({ id: THERMAL_SENSOR_STABILITY_LIBRARY_ID, version: THERMAL_SENSOR_STABILITY_LIBRARY_VERSION,
    merge: mergeThermalSensorStabilityReports, plan: buildThermalSensorStabilityPlan, envelope: buildThermalSensorStabilityEnvelope });
}
