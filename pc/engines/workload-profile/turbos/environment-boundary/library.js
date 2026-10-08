/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated workload-profile environment-boundary library. It validates
 * environment evidence and returns bounded review plans without mutation.
 */
export const WORKLOAD_ENVIRONMENT_BOUNDARY_LIBRARY_ID = 'workload-profile.environment-boundary.library';
export const WORKLOAD_ENVIRONMENT_BOUNDARY_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['interactive-boundary', 'headless-boundary', 'environment-drift-observed', 'environment-drift-sustained', 'observation-required', 'profile-required', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Environment-boundary library report must be an object');
  if (report.turbo !== 'workload-profile.environment-boundary') throw new Error('Environment-boundary library requires an environment-boundary turbo report');
  if (!STATES.includes(report.state)) throw new Error('Environment-boundary library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Environment-boundary library sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Environment-boundary library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Environment-boundary library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['observedCount', 'observed count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['changeCount', 'change count']]) if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Environment-boundary library ${label} must be from 0 to 4096`);
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Environment-boundary library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Environment-boundary library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) { if (!Array.isArray(reports)) throw new TypeError('Environment-boundary library reports must be an array'); if (reports.length > 64) throw new RangeError('Environment-boundary library accepts at most 64 reports'); return Object.freeze(reports.map(requireReport)); }
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'profile-required')) return 'profile-required';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.some((report) => report.state === 'environment-drift-sustained')) return 'environment-drift-sustained';
  if (reports.some((report) => report.state === 'environment-drift-observed')) return 'environment-drift-observed';
  if (reports.some((report) => report.state === 'headless-boundary')) return 'headless-boundary';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'interactive-boundary';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-environment-samples']);
  if (state === 'profile-required') return Object.freeze(['request-environment-profile']);
  if (state === 'observation-required') return Object.freeze(['request-complete-environment-observation']);
  if (state === 'environment-drift-sustained') return Object.freeze(['review-environment-boundary-drift']);
  if (state === 'environment-drift-observed') return Object.freeze(['observe-environment-boundary-stability']);
  if (state === 'headless-boundary') return Object.freeze(['preserve-headless-boundary']);
  return Object.freeze(['preserve-interactive-boundary']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'profile-required') return 'profile-required';
  if (state === 'observation-required') return 'evidence-bootstrap';
  if (state === 'environment-drift-sustained') return 'boundary-review';
  if (state === 'environment-drift-observed') return 'boundary-observation';
  if (state === 'headless-boundary') return 'headless-observation';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'interactive-observation';
}
function intervalFor(state, environment) {
  if (state === 'profile-required' || state === 'observation-required' || state === 'insufficient-data') return 2000;
  if (state === 'environment-drift-sustained') return 750;
  if (state === 'environment-drift-observed') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeWorkloadEnvironmentBoundaryReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: WORKLOAD_ENVIRONMENT_BOUNDARY_LIBRARY_ID, libraryVersion: WORKLOAD_ENVIRONMENT_BOUNDARY_LIBRARY_VERSION, reportCount: validated.length, state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0), observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0), comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0), finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildWorkloadEnvironmentBoundaryPlan(report, environment) { const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment); return Object.freeze({ library: WORKLOAD_ENVIRONMENT_BOUNDARY_LIBRARY_ID, environment: normalizedEnvironment, mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment), state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence }); }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Environment-boundary library clock must return a number'); return timestamp; }
export function buildWorkloadEnvironmentBoundaryEnvelope(report, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Environment-boundary library trigger is required'); return Object.freeze({ library: WORKLOAD_ENVIRONMENT_BOUNDARY_LIBRARY_ID, libraryVersion: WORKLOAD_ENVIRONMENT_BOUNDARY_LIBRARY_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) }); }
export function createWorkloadEnvironmentBoundaryLibrary() { return Object.freeze({ id: WORKLOAD_ENVIRONMENT_BOUNDARY_LIBRARY_ID, version: WORKLOAD_ENVIRONMENT_BOUNDARY_LIBRARY_VERSION, merge: mergeWorkloadEnvironmentBoundaryReports, plan: buildWorkloadEnvironmentBoundaryPlan, envelope: buildWorkloadEnvironmentBoundaryEnvelope }); }
