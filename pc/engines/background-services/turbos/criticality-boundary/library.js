/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated criticality-boundary library. It validates and plans critical
 * service evidence without importing a service-control API.
 */
export const BACKGROUND_CRITICALITY_LIBRARY_ID = 'background-services.criticality-boundary.library';
export const BACKGROUND_CRITICALITY_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['critical-services-observe', 'critical-observation-required', 'protect-critical-services', 'no-critical-services', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Criticality library report must be an object');
  if (report.turbo !== 'background-services.criticality-boundary') throw new Error('Criticality library requires a criticality-boundary turbo report');
  if (!STATES.includes(report.state)) throw new Error('Criticality library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Criticality library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Criticality library minimumSamples must be from 1 to 64');
  for (const [field, label] of [['serviceCount', 'service count'], ['criticalCount', 'critical count'], ['failedCriticalCount', 'failed-critical count'], ['unknownCriticalCount', 'unknown-critical count'], ['userOwnedCriticalCount', 'user-owned critical count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Criticality library ${label} must be from 0 to 4096`);
  }
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Criticality library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Criticality library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Criticality library reports must be an array');
  if (reports.length > 64) throw new RangeError('Criticality library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'protect-critical-services')) return 'protect-critical-services';
  if (reports.some((report) => report.state === 'critical-observation-required')) return 'critical-observation-required';
  if (reports.every((report) => report.state === 'no-critical-services')) return 'no-critical-services';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'critical-services-observe';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-critical-service-samples']);
  if (state === 'no-critical-services') return Object.freeze(['no-critical-service-review']);
  if (state === 'protect-critical-services') return Object.freeze(['protect-critical-services', 'review-service-owner']);
  if (state === 'critical-observation-required') return Object.freeze(['request-critical-service-state-observation']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'protect-critical-services') return 'critical-protection';
  if (state === 'critical-observation-required') return 'critical-evidence-bootstrap';
  if (state === 'no-critical-services') return 'empty-observation';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'critical-observation';
}
function intervalFor(state, environment) {
  if (state === 'protect-critical-services') return 500;
  if (state === 'critical-observation-required' || state === 'insufficient-data') return 2000;
  if (state === 'no-critical-services') return 10000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeBackgroundCriticalityReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: BACKGROUND_CRITICALITY_LIBRARY_ID, libraryVersion: BACKGROUND_CRITICALITY_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    serviceCount: latest?.serviceCount || 0, criticalCount: latest?.criticalCount || 0,
    failedCriticalCount: latest?.failedCriticalCount || 0, unknownCriticalCount: latest?.unknownCriticalCount || 0,
    userOwnedCriticalCount: latest?.userOwnedCriticalCount || 0, finalEnvironment: latest?.finalEnvironment || 'unknown',
    confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildBackgroundCriticalityPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: BACKGROUND_CRITICALITY_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Criticality library clock must return a number'); return timestamp; }
export function buildBackgroundCriticalityEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Criticality library trigger is required');
  return Object.freeze({ library: BACKGROUND_CRITICALITY_LIBRARY_ID, libraryVersion: BACKGROUND_CRITICALITY_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createBackgroundCriticalityLibrary() {
  return Object.freeze({ id: BACKGROUND_CRITICALITY_LIBRARY_ID, version: BACKGROUND_CRITICALITY_LIBRARY_VERSION,
    merge: mergeBackgroundCriticalityReports, plan: buildBackgroundCriticalityPlan, envelope: buildBackgroundCriticalityEnvelope });
}
