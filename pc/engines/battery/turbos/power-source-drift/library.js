/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated power-source-drift library. It validates source evidence and
 * builds review plans without toggling charging or power policy.
 */
export const BATTERY_POWER_SOURCE_DRIFT_LIBRARY_ID = 'battery.power-source-drift.library';
export const BATTERY_POWER_SOURCE_DRIFT_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-source', 'source-drift-observed', 'source-drift-sustained', 'no-battery', 'observation-required', 'source-unknown', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Power-source-drift library report must be an object');
  if (report.turbo !== 'battery.power-source-drift') throw new Error('Power-source-drift library requires a power-source-drift turbo report');
  if (!STATES.includes(report.state)) throw new Error('Power-source-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Power-source-drift library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Power-source-drift library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Power-source-drift library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['observedCount', 'observed count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['presenceChangeCount', 'presence-change count'], ['chargingChangeCount', 'charging-change count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Power-source-drift library ${label} must be from 0 to 4096`);
  }
  if (report.finalPresent !== null && typeof report.finalPresent !== 'boolean') throw new TypeError('Power-source-drift library finalPresent must be boolean or null');
  if (report.finalCharging !== null && typeof report.finalCharging !== 'boolean') throw new TypeError('Power-source-drift library finalCharging must be boolean or null');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Power-source-drift library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Power-source-drift library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Power-source-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Power-source-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-battery')) return 'no-battery';
  if (reports.some((report) => report.state === 'source-drift-sustained')) return 'source-drift-sustained';
  if (reports.some((report) => report.state === 'source-drift-observed')) return 'source-drift-observed';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.every((report) => report.state === 'source-unknown')) return 'source-unknown';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-source';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-power-source-samples']);
  if (state === 'source-unknown') return Object.freeze(['request-power-source-observation']);
  if (state === 'no-battery') return Object.freeze(['keep-battery-controls-disabled']);
  if (state === 'observation-required') return Object.freeze(['request-complete-power-source-observation']);
  if (state === 'source-drift-sustained') return Object.freeze(['review-power-source-drift-without-control-change']);
  if (state === 'source-drift-observed') return Object.freeze(['observe-power-source-stability']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'no-battery') return 'empty-observation';
  if (state === 'source-drift-sustained') return 'source-review';
  if (state === 'source-drift-observed') return 'source-observation';
  if (state === 'observation-required' || state === 'source-unknown' || state === 'insufficient-data') return 'evidence-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'no-battery') return 10000;
  if (state === 'source-drift-sustained') return 1000;
  if (state === 'source-drift-observed') return 1500;
  if (state === 'observation-required' || state === 'source-unknown' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeBatteryPowerSourceDriftReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: BATTERY_POWER_SOURCE_DRIFT_LIBRARY_ID, libraryVersion: BATTERY_POWER_SOURCE_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), presenceChangeCount: validated.reduce((sum, report) => sum + report.presenceChangeCount, 0),
    chargingChangeCount: validated.reduce((sum, report) => sum + report.chargingChangeCount, 0), finalPresent: latest?.finalPresent ?? null,
    finalCharging: latest?.finalCharging ?? null, finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0,
    recommendations: recommendations(state) });
}
export function buildBatteryPowerSourceDriftPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: BATTERY_POWER_SOURCE_DRIFT_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Power-source-drift library clock must return a number'); return timestamp; }
export function buildBatteryPowerSourceDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Power-source-drift library trigger is required');
  return Object.freeze({ library: BATTERY_POWER_SOURCE_DRIFT_LIBRARY_ID, libraryVersion: BATTERY_POWER_SOURCE_DRIFT_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createBatteryPowerSourceDriftLibrary() {
  return Object.freeze({ id: BATTERY_POWER_SOURCE_DRIFT_LIBRARY_ID, version: BATTERY_POWER_SOURCE_DRIFT_LIBRARY_VERSION,
    merge: mergeBatteryPowerSourceDriftReports, plan: buildBatteryPowerSourceDriftPlan, envelope: buildBatteryPowerSourceDriftEnvelope });
}
