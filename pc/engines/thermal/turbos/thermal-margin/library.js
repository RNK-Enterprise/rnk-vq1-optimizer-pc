/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated thermal-margin library. It validates headroom evidence and builds
 * observation plans without importing fan, governor, or power controls.
 */
export const THERMAL_MARGIN_LIBRARY_ID = 'thermal.thermal-margin.library';
export const THERMAL_MARGIN_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-margin', 'margin-recovery-observed', 'low-margin', 'margin-collapse-observed', 'margin-collapse-sustained', 'critical-margin', 'observation-required', 'margin-unknown', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Thermal margin library report must be an object');
  if (report.turbo !== 'thermal.thermal-margin') throw new Error('Thermal margin library requires a thermal-margin turbo report');
  if (!STATES.includes(report.state)) throw new Error('Thermal margin library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Thermal margin library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Thermal margin library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Thermal margin library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['observedCount', 'observed count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['changedCount', 'changed count'], ['fallingCount', 'falling count'], ['risingCount', 'rising count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Thermal margin library ${label} must be from 0 to 4096`);
  }
  for (const [field, label] of [['finalHeadroomCelsius', 'final headroom'], ['finalTemperatureCelsius', 'final temperature'], ['finalCriticalCelsius', 'final critical temperature']]) {
    if (!Number.isFinite(report[field]) && report[field] !== null) throw new TypeError(`Thermal margin library ${label} must be numeric or null`);
  }
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Thermal margin library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Thermal margin library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Thermal margin library reports must be an array');
  if (reports.length > 64) throw new RangeError('Thermal margin library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'critical-margin')) return 'critical-margin';
  if (reports.some((report) => report.state === 'margin-collapse-sustained')) return 'margin-collapse-sustained';
  if (reports.some((report) => report.state === 'margin-collapse-observed')) return 'margin-collapse-observed';
  if (reports.some((report) => report.state === 'low-margin')) return 'low-margin';
  if (reports.some((report) => report.state === 'margin-recovery-observed')) return 'margin-recovery-observed';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.every((report) => report.state === 'margin-unknown')) return 'margin-unknown';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-margin';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-thermal-margin-samples']);
  if (state === 'margin-unknown') return Object.freeze(['request-thermal-margin-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-thermal-margin-observation']);
  if (state === 'critical-margin') return Object.freeze(['protect-thermal-headroom', 'request-user-approved-thermal-response']);
  if (state === 'margin-collapse-sustained') return Object.freeze(['review-thermal-margin-collapse-without-mutation']);
  if (state === 'margin-collapse-observed') return Object.freeze(['observe-thermal-margin-stability']);
  if (state === 'low-margin') return Object.freeze(['review-low-thermal-margin']);
  if (state === 'margin-recovery-observed') return Object.freeze(['observe-thermal-margin-recovery']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'critical-margin') return 'thermal-protection-review';
  if (state === 'margin-collapse-sustained') return 'margin-collapse-review';
  if (state === 'margin-collapse-observed') return 'margin-observation';
  if (state === 'low-margin') return 'headroom-review';
  if (state === 'margin-recovery-observed') return 'recovery-observation';
  if (state === 'observation-required' || state === 'margin-unknown' || state === 'insufficient-data') return 'evidence-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'critical-margin') return 500;
  if (state === 'margin-collapse-sustained') return 750;
  if (state === 'margin-collapse-observed' || state === 'low-margin') return 1000;
  if (state === 'margin-recovery-observed') return 1500;
  if (state === 'observation-required' || state === 'margin-unknown' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeThermalMarginReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: THERMAL_MARGIN_LIBRARY_ID, libraryVersion: THERMAL_MARGIN_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), changedCount: validated.reduce((sum, report) => sum + report.changedCount, 0),
    fallingCount: validated.reduce((sum, report) => sum + report.fallingCount, 0), risingCount: validated.reduce((sum, report) => sum + report.risingCount, 0),
    finalHeadroomCelsius: latest?.finalHeadroomCelsius ?? null, finalTemperatureCelsius: latest?.finalTemperatureCelsius ?? null,
    finalCriticalCelsius: latest?.finalCriticalCelsius ?? null, finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0,
    recommendations: recommendations(state) });
}
export function buildThermalMarginPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: THERMAL_MARGIN_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Thermal margin library clock must return a number'); return timestamp; }
export function buildThermalMarginEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Thermal margin library trigger is required');
  return Object.freeze({ library: THERMAL_MARGIN_LIBRARY_ID, libraryVersion: THERMAL_MARGIN_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createThermalMarginLibrary() {
  return Object.freeze({ id: THERMAL_MARGIN_LIBRARY_ID, version: THERMAL_MARGIN_LIBRARY_VERSION,
    merge: mergeThermalMarginReports, plan: buildThermalMarginPlan, envelope: buildThermalMarginEnvelope });
}
