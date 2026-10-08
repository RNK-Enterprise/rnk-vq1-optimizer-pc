/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated throttle-onset library. It validates ratio-band evidence and
 * builds observation plans without importing thermal control APIs.
 */
export const THERMAL_THROTTLE_ONSET_LIBRARY_ID = 'thermal.throttle-onset.library';
export const THERMAL_THROTTLE_ONSET_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['below-threshold', 'watch-threshold', 'throttle-risk', 'throttle-risk-sustained', 'critical-threshold', 'threshold-crossing-observed', 'threshold-crossing-sustained', 'observation-required', 'threshold-unknown', 'insufficient-data']);
const BANDS = Object.freeze(['below-threshold', 'watch-threshold', 'throttle-risk', 'critical-threshold', 'unknown']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Throttle-onset library report must be an object');
  if (report.turbo !== 'thermal.throttle-onset') throw new Error('Throttle-onset library requires a throttle-onset turbo report');
  if (!STATES.includes(report.state)) throw new Error('Throttle-onset library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Throttle-onset library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Throttle-onset library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Throttle-onset library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['observedCount', 'observed count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['changedCount', 'changed count'], ['crossingCount', 'crossing count'], ['riskCount', 'risk count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Throttle-onset library ${label} must be from 0 to 4096`);
  }
  if (!Number.isFinite(report.finalRatioPercent) && report.finalRatioPercent !== null) throw new TypeError('Throttle-onset library finalRatioPercent must be numeric or null');
  if (report.finalRatioPercent !== null && report.finalRatioPercent < 0) throw new RangeError('Throttle-onset library finalRatioPercent must be non-negative');
  if (!BANDS.includes(report.finalBand)) throw new TypeError('Throttle-onset library finalBand must be normalized');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Throttle-onset library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Throttle-onset library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Throttle-onset library reports must be an array');
  if (reports.length > 64) throw new RangeError('Throttle-onset library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'critical-threshold')) return 'critical-threshold';
  if (reports.some((report) => report.state === 'throttle-risk-sustained')) return 'throttle-risk-sustained';
  if (reports.some((report) => report.state === 'throttle-risk')) return 'throttle-risk';
  if (reports.some((report) => report.state === 'watch-threshold')) return 'watch-threshold';
  if (reports.some((report) => report.state === 'threshold-crossing-sustained')) return 'threshold-crossing-sustained';
  if (reports.some((report) => report.state === 'threshold-crossing-observed')) return 'threshold-crossing-observed';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.every((report) => report.state === 'threshold-unknown')) return 'threshold-unknown';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'below-threshold';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-throttle-onset-samples']);
  if (state === 'threshold-unknown') return Object.freeze(['request-throttle-onset-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-throttle-onset-observation']);
  if (state === 'critical-threshold') return Object.freeze(['protect-critical-thermal-threshold', 'request-user-approved-thermal-response']);
  if (state === 'throttle-risk-sustained') return Object.freeze(['review-throttle-risk-without-mutation']);
  if (state === 'throttle-risk') return Object.freeze(['observe-throttle-onset']);
  if (state === 'watch-threshold') return Object.freeze(['observe-thermal-threshold']);
  if (state === 'threshold-crossing-sustained') return Object.freeze(['review-thermal-threshold-churn']);
  if (state === 'threshold-crossing-observed') return Object.freeze(['observe-thermal-threshold-stability']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'critical-threshold') return 'critical-threshold-review';
  if (state === 'throttle-risk-sustained') return 'throttle-risk-review';
  if (state === 'throttle-risk') return 'throttle-observation';
  if (state === 'watch-threshold') return 'threshold-observation';
  if (state === 'threshold-crossing-sustained') return 'threshold-churn-review';
  if (state === 'threshold-crossing-observed') return 'threshold-churn-observation';
  if (state === 'observation-required' || state === 'threshold-unknown' || state === 'insufficient-data') return 'evidence-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'critical-threshold') return 500;
  if (state === 'throttle-risk-sustained') return 750;
  if (state === 'throttle-risk' || state === 'watch-threshold') return 1000;
  if (state === 'threshold-crossing-sustained') return 1250;
  if (state === 'threshold-crossing-observed') return 1500;
  if (state === 'observation-required' || state === 'threshold-unknown' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeThermalThrottleOnsetReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: THERMAL_THROTTLE_ONSET_LIBRARY_ID, libraryVersion: THERMAL_THROTTLE_ONSET_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), changedCount: validated.reduce((sum, report) => sum + report.changedCount, 0),
    crossingCount: validated.reduce((sum, report) => sum + report.crossingCount, 0), riskCount: validated.reduce((sum, report) => sum + report.riskCount, 0),
    finalRatioPercent: latest?.finalRatioPercent ?? null, finalBand: latest?.finalBand || 'unknown', finalEnvironment: latest?.finalEnvironment || 'unknown',
    confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildThermalThrottleOnsetPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: THERMAL_THROTTLE_ONSET_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Throttle-onset library clock must return a number'); return timestamp; }
export function buildThermalThrottleOnsetEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Throttle-onset library trigger is required');
  return Object.freeze({ library: THERMAL_THROTTLE_ONSET_LIBRARY_ID, libraryVersion: THERMAL_THROTTLE_ONSET_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createThermalThrottleOnsetLibrary() {
  return Object.freeze({ id: THERMAL_THROTTLE_ONSET_LIBRARY_ID, version: THERMAL_THROTTLE_ONSET_LIBRARY_VERSION,
    merge: mergeThermalThrottleOnsetReports, plan: buildThermalThrottleOnsetPlan, envelope: buildThermalThrottleOnsetEnvelope });
}
