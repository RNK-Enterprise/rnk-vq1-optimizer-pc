/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated health-boundary library. It validates health evidence and builds
 * review plans without changing charging, power policy, or battery state.
 */
export const BATTERY_HEALTH_BOUNDARY_LIBRARY_ID = 'battery.health-boundary.library';
export const BATTERY_HEALTH_BOUNDARY_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-health', 'health-drift-observed', 'health-degradation-sustained', 'protect-health', 'no-battery', 'observation-required', 'health-unknown', 'insufficient-data']);
const HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'failed', 'unknown']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Health-boundary library report must be an object');
  if (report.turbo !== 'battery.health-boundary') throw new Error('Health-boundary library requires a health-boundary turbo report');
  if (!STATES.includes(report.state)) throw new Error('Health-boundary library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Health-boundary library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Health-boundary library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Health-boundary library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['observedCount', 'observed count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['changedCount', 'changed count'], ['degradationCount', 'degradation count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Health-boundary library ${label} must be from 0 to 4096`);
  }
  if (!HEALTH_STATES.includes(report.finalHealth)) throw new TypeError('Health-boundary library finalHealth must be normalized');
  if (report.finalPresent !== null && typeof report.finalPresent !== 'boolean') throw new TypeError('Health-boundary library finalPresent must be boolean or null');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Health-boundary library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Health-boundary library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Health-boundary library reports must be an array');
  if (reports.length > 64) throw new RangeError('Health-boundary library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'protect-health')) return 'protect-health';
  if (reports.some((report) => report.state === 'no-battery')) return 'no-battery';
  if (reports.some((report) => report.state === 'health-degradation-sustained')) return 'health-degradation-sustained';
  if (reports.some((report) => report.state === 'health-drift-observed')) return 'health-drift-observed';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.every((report) => report.state === 'health-unknown')) return 'health-unknown';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-health';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-health-samples']);
  if (state === 'no-battery') return Object.freeze(['keep-battery-controls-disabled']);
  if (state === 'health-unknown') return Object.freeze(['request-health-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-health-observation']);
  if (state === 'protect-health') return Object.freeze(['protect-power', 'request-user-approved-battery-review']);
  if (state === 'health-degradation-sustained') return Object.freeze(['review-battery-health-without-policy-change']);
  if (state === 'health-drift-observed') return Object.freeze(['observe-health-stability']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'protect-health') return 'health-protection';
  if (state === 'no-battery') return 'empty-observation';
  if (state === 'health-degradation-sustained') return 'health-review';
  if (state === 'health-drift-observed') return 'health-observation';
  if (state === 'observation-required') return 'evidence-bootstrap';
  if (state === 'health-unknown' || state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'protect-health') return 500;
  if (state === 'health-degradation-sustained') return 1000;
  if (state === 'health-drift-observed') return 1500;
  if (state === 'no-battery') return 10000;
  if (state === 'observation-required' || state === 'health-unknown' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeBatteryHealthBoundaryReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: BATTERY_HEALTH_BOUNDARY_LIBRARY_ID, libraryVersion: BATTERY_HEALTH_BOUNDARY_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), changedCount: validated.reduce((sum, report) => sum + report.changedCount, 0),
    degradationCount: validated.reduce((sum, report) => sum + report.degradationCount, 0), finalHealth: latest?.finalHealth || 'unknown',
    finalPresent: latest?.finalPresent ?? null, finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0,
    recommendations: recommendations(state) });
}
export function buildBatteryHealthBoundaryPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: BATTERY_HEALTH_BOUNDARY_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Health-boundary library clock must return a number'); return timestamp; }
export function buildBatteryHealthBoundaryEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Health-boundary library trigger is required');
  return Object.freeze({ library: BATTERY_HEALTH_BOUNDARY_LIBRARY_ID, libraryVersion: BATTERY_HEALTH_BOUNDARY_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createBatteryHealthBoundaryLibrary() {
  return Object.freeze({ id: BATTERY_HEALTH_BOUNDARY_LIBRARY_ID, version: BATTERY_HEALTH_BOUNDARY_LIBRARY_VERSION,
    merge: mergeBatteryHealthBoundaryReports, plan: buildBatteryHealthBoundaryPlan, envelope: buildBatteryHealthBoundaryEnvelope });
}
