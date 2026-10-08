/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated state-drift library. It validates, aggregates, and plans service
 * state reports without importing a service-control API.
 */
export const BACKGROUND_STATE_DRIFT_LIBRARY_ID = 'background-services.state-drift.library';
export const BACKGROUND_STATE_DRIFT_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-services', 'state-drift-observed', 'state-drift-sustained', 'protect-services', 'observation-required', 'no-services', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('State-drift library report must be an object');
  if (report.turbo !== 'background-services.state-drift') throw new Error('State-drift library requires a state-drift turbo report');
  if (!STATES.includes(report.state)) throw new Error('State-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('State-drift library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('State-drift library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('State-drift library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['serviceCount', 'service count'], ['namedCount', 'named count'], ['runningCount', 'running count'], ['stoppedCount', 'stopped count'], ['failedCount', 'failed count'], ['unknownCount', 'unknown count'], ['criticalFailureCount', 'critical-failure count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`State-drift library ${label} must be from 0 to 4096`);
  }
  if (!Number.isInteger(report.comparisonCount) || report.comparisonCount < 0 || report.comparisonCount > Math.max(0, report.sampleCount - 1)) throw new RangeError('State-drift library comparisonCount must fit inside the sample window');
  for (const [field, label] of [['changeCount', 'change count'], ['runningChangeCount', 'running-change count'], ['stoppedChangeCount', 'stopped-change count'], ['failedChangeCount', 'failed-change count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.comparisonCount) throw new RangeError(`State-drift library ${label} must fit inside comparisonCount`);
  }
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('State-drift library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('State-drift library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('State-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('State-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'protect-services')) return 'protect-services';
  if (reports.some((report) => report.state === 'state-drift-sustained')) return 'state-drift-sustained';
  if (reports.some((report) => report.state === 'state-drift-observed')) return 'state-drift-observed';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.every((report) => report.state === 'no-services')) return 'no-services';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-services';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-service-samples']);
  if (state === 'no-services') return Object.freeze(['no-background-service-review']);
  if (state === 'protect-services') return Object.freeze(['protect-services', 'review-service-owner']);
  if (state === 'state-drift-sustained') return Object.freeze(['review-service-state-drift']);
  if (state === 'state-drift-observed') return Object.freeze(['observe-service-state-stability']);
  if (state === 'observation-required') return Object.freeze(['request-service-state-observation']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'protect-services') return 'service-protection';
  if (state === 'state-drift-sustained') return 'state-review';
  if (state === 'state-drift-observed') return 'state-observation';
  if (state === 'observation-required') return 'evidence-bootstrap';
  if (state === 'no-services') return 'empty-observation';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'protect-services') return 500;
  if (state === 'state-drift-sustained') return 1000;
  if (state === 'state-drift-observed') return 1500;
  if (state === 'observation-required' || state === 'insufficient-data') return 2000;
  if (state === 'no-services') return 10000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeBackgroundStateDriftReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: BACKGROUND_STATE_DRIFT_LIBRARY_ID, libraryVersion: BACKGROUND_STATE_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    serviceCount: latest?.serviceCount || 0, namedCount: latest?.namedCount || 0, runningCount: latest?.runningCount || 0,
    stoppedCount: latest?.stoppedCount || 0, failedCount: latest?.failedCount || 0, unknownCount: latest?.unknownCount || 0,
    criticalFailureCount: latest?.criticalFailureCount || 0, comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0), finalEnvironment: latest?.finalEnvironment || 'unknown',
    confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildBackgroundStateDriftPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: BACKGROUND_STATE_DRIFT_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('State-drift library clock must return a number'); return timestamp; }
export function buildBackgroundStateDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('State-drift library trigger is required');
  return Object.freeze({ library: BACKGROUND_STATE_DRIFT_LIBRARY_ID, libraryVersion: BACKGROUND_STATE_DRIFT_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createBackgroundStateDriftLibrary() {
  return Object.freeze({ id: BACKGROUND_STATE_DRIFT_LIBRARY_ID, version: BACKGROUND_STATE_DRIFT_LIBRARY_VERSION,
    merge: mergeBackgroundStateDriftReports, plan: buildBackgroundStateDriftPlan, envelope: buildBackgroundStateDriftEnvelope });
}
