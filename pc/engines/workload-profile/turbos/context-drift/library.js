/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated workload-profile context-drift library. It validates and merges
 * context reports without importing process, application, or OS controls.
 */

export const WORKLOAD_CONTEXT_DRIFT_LIBRARY_ID = 'workload-profile.context-drift.library';
export const WORKLOAD_CONTEXT_DRIFT_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-context', 'context-drift-observed', 'context-drift-sustained', 'observation-required', 'profile-required', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const WORKLOADS = Object.freeze(['gaming', 'creative', 'development', 'server', 'idle', 'unknown']);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Context-drift library report must be an object');
  if (report.turbo !== 'workload-profile.context-drift') throw new Error('Context-drift library requires a context-drift turbo report');
  if (!STATES.includes(report.state)) throw new Error('Context-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Context-drift library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Context-drift library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Context-drift library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['observedCount', 'observed count'], ['unknownCount', 'unknown count'], ['comparisonCount', 'comparison count'], ['changeCount', 'change count'], ['environmentChangeCount', 'environment-change count'], ['kindChangeCount', 'kind-change count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Context-drift library ${label} must be from 0 to 4096`);
  }
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Context-drift library finalEnvironment must be normalized');
  if (!WORKLOADS.includes(report.finalWorkloadKind)) throw new TypeError('Context-drift library finalWorkloadKind must be normalized');
  if (report.finalWorkloadName !== null && typeof report.finalWorkloadName !== 'string') throw new TypeError('Context-drift library finalWorkloadName must be a string or null');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Context-drift library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Context-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Context-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'profile-required')) return 'profile-required';
  if (reports.some((report) => report.state === 'observation-required')) return 'observation-required';
  if (reports.some((report) => report.state === 'context-drift-sustained')) return 'context-drift-sustained';
  if (reports.some((report) => report.state === 'context-drift-observed')) return 'context-drift-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-context';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-workload-context']);
  if (state === 'profile-required') return Object.freeze(['request-workload-context-profile']);
  if (state === 'observation-required') return Object.freeze(['request-complete-workload-context']);
  if (state === 'context-drift-sustained') return Object.freeze(['review-workload-context-drift']);
  if (state === 'context-drift-observed') return Object.freeze(['observe-workload-context-stability']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'profile-required') return 'profile-required';
  if (state === 'observation-required') return 'evidence-bootstrap';
  if (state === 'context-drift-sustained') return 'context-drift-review';
  if (state === 'context-drift-observed') return 'context-drift-observation';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'profile-required') return 2000;
  if (state === 'observation-required' || state === 'insufficient-data') return 2000;
  if (state === 'context-drift-sustained') return 750;
  if (state === 'context-drift-observed') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeWorkloadContextDriftReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: WORKLOAD_CONTEXT_DRIFT_LIBRARY_ID, libraryVersion: WORKLOAD_CONTEXT_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0),
    environmentChangeCount: validated.reduce((sum, report) => sum + report.environmentChangeCount, 0), kindChangeCount: validated.reduce((sum, report) => sum + report.kindChangeCount, 0),
    finalEnvironment: latest?.finalEnvironment || 'unknown', finalWorkloadKind: latest?.finalWorkloadKind || 'unknown',
    finalWorkloadName: latest?.finalWorkloadName ?? null, confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildWorkloadContextDriftPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: WORKLOAD_CONTEXT_DRIFT_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Context-drift library clock must return a number'); return timestamp; }
export function buildWorkloadContextDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Context-drift library trigger is required');
  return Object.freeze({ library: WORKLOAD_CONTEXT_DRIFT_LIBRARY_ID, libraryVersion: WORKLOAD_CONTEXT_DRIFT_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createWorkloadContextDriftLibrary() {
  return Object.freeze({ id: WORKLOAD_CONTEXT_DRIFT_LIBRARY_ID, version: WORKLOAD_CONTEXT_DRIFT_LIBRARY_VERSION,
    merge: mergeWorkloadContextDriftReports, plan: buildWorkloadContextDriftPlan, envelope: buildWorkloadContextDriftEnvelope });
}
