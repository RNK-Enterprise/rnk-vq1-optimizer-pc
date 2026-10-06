/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated priority-drift library. It validates, aggregates, and plans
 * priority movement reports without importing the turbo or changing process
 * state.
 */

export const PROCESS_PRIORITY_DRIFT_LIBRARY_ID = 'process-priority.priority-drift.library';
export const PROCESS_PRIORITY_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'priority-drift-sustained', 'priority-drift-observed', 'stable-priority',
  'no-processes', 'incomplete-priority-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Priority-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Priority-drift library report must be an object');
  if (report.turbo !== 'process-priority.priority-drift') {
    throw new Error('Priority-drift library requires a priority-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Priority-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Priority-drift library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Priority-drift library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.changeThreshold) || report.changeThreshold < 1
    || report.changeThreshold > 64) {
    throw new RangeError('Priority-drift library changeThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noProcessCount', 'no-process count'], ['transitionCount', 'transition count'],
    ['comparisonCount', 'comparison count']
  ]) requireCount(report, field, label);
  if (report.latestPrioritySignature !== null && typeof report.latestPrioritySignature !== 'string') {
    throw new TypeError('Priority-drift library latestPrioritySignature must be null or a string');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Priority-drift library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Priority-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Priority-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-processes')) return 'no-processes';
  if (reports.some((report) => report.state === 'incomplete-priority-evidence')) {
    return 'incomplete-priority-evidence';
  }
  if (reports.some((report) => report.state === 'priority-drift-sustained')) {
    return 'priority-drift-sustained';
  }
  if (reports.some((report) => report.state === 'priority-drift-observed')) {
    return 'priority-drift-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-priority';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-priority-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-priority-review']);
  if (state === 'incomplete-priority-evidence') {
    return Object.freeze(['request-documented-priority-observation']);
  }
  if (state === 'priority-drift-sustained') {
    return Object.freeze(['review-priority-drift', 'hold-unapproved-priority-policy']);
  }
  if (state === 'priority-drift-observed') return Object.freeze(['observe-next-priority-sample']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'priority-drift-sustained') return 'priority-drift-review';
  if (state === 'priority-drift-observed') return 'priority-drift-observation';
  if (state === 'no-processes') return 'no-process-observation';
  if (state === 'incomplete-priority-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-priority-observation';
}

function intervalFor(state, environment) {
  if (state === 'priority-drift-sustained') return 750;
  if (state === 'priority-drift-observed') return 1000;
  if (state === 'no-processes') return 10000;
  if (state === 'incomplete-priority-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latestSignature(reports) {
  const latest = reports.at(-1);
  return latest ? latest.latestPrioritySignature : null;
}

export function mergeProcessPriorityDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: PROCESS_PRIORITY_DRIFT_LIBRARY_ID,
    libraryVersion: PROCESS_PRIORITY_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noProcessCount: validated.reduce((sum, report) => sum + report.noProcessCount, 0),
    transitionCount: validated.reduce((sum, report) => sum + report.transitionCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    latestPrioritySignature: latestSignature(validated),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildProcessPriorityDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: PROCESS_PRIORITY_DRIFT_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0 ? 0
      : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Priority-drift library clock must return a number');
  return timestamp;
}

export function buildProcessPriorityDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Priority-drift library trigger is required');
  }
  return Object.freeze({
    library: PROCESS_PRIORITY_DRIFT_LIBRARY_ID,
    libraryVersion: PROCESS_PRIORITY_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createProcessPriorityDriftLibrary() {
  return Object.freeze({
    id: PROCESS_PRIORITY_DRIFT_LIBRARY_ID,
    version: PROCESS_PRIORITY_DRIFT_LIBRARY_VERSION,
    merge: mergeProcessPriorityDriftReports,
    plan: buildProcessPriorityDriftPlan,
    envelope: buildProcessPriorityDriftEnvelope
  });
}
