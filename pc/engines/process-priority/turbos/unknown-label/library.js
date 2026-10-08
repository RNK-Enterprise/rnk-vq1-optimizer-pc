/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated unknown-label library. It validates, aggregates, and plans
 * undocumented priority-label reports without importing the turbo or changing
 * process state.
 */

export const PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_ID = 'process-priority.unknown-label.library';
export const PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'unknown-priority-sustained', 'unknown-priority-observed', 'documented-priority',
  'no-processes', 'incomplete-priority-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Unknown-label library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function rate(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Unknown-label library ${label} must be between 0 and 1`);
  }
  return value;
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Unknown-label library report must be an object');
  if (report.turbo !== 'process-priority.unknown-label') {
    throw new Error('Unknown-label library requires an unknown-label turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Unknown-label library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Unknown-label library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Unknown-label library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Unknown-label library persistenceThreshold must be from 1 to 64');
  }
  rate(report.rateThreshold, 'rateThreshold');
  for (const [field, label] of [
    ['processCount', 'process count'], ['observedCount', 'observed count'],
    ['incompleteCount', 'incomplete count'], ['noProcessCount', 'no-process count'],
    ['unknownSamples', 'unknown sample count']
  ]) requireCount(report, field, label);
  if (!Number.isInteger(report.unknownCount) || report.unknownCount < 0) {
    throw new RangeError('Unknown-label library unknownCount must be non-negative');
  }
  if (!Number.isInteger(report.latestUnknownCount) || report.latestUnknownCount < 0) {
    throw new RangeError('Unknown-label library latestUnknownCount must be non-negative');
  }
  rate(report.latestUnknownRate, 'latestUnknownRate');
  rate(report.maximumRate, 'maximumRate');
  rate(report.confidence, 'confidence');
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Unknown-label library reports must be an array');
  if (reports.length > 64) throw new RangeError('Unknown-label library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-processes')) return 'no-processes';
  if (reports.some((report) => report.state === 'incomplete-priority-evidence')) {
    return 'incomplete-priority-evidence';
  }
  if (reports.some((report) => report.state === 'unknown-priority-sustained')) {
    return 'unknown-priority-sustained';
  }
  if (reports.some((report) => report.state === 'unknown-priority-observed')) {
    return 'unknown-priority-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'documented-priority';
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
    return Object.freeze(['request-priority-environment-evidence']);
  }
  if (state === 'unknown-priority-sustained') {
    return Object.freeze(['document-priority-labels', 'hold-unknown-priority-policy']);
  }
  if (state === 'unknown-priority-observed') return Object.freeze(['observe-next-priority-label']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'unknown-priority-sustained') return 'priority-label-review';
  if (state === 'unknown-priority-observed') return 'priority-label-observation';
  if (state === 'no-processes') return 'no-process-observation';
  if (state === 'incomplete-priority-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'documented-priority-observation';
}

function intervalFor(state, environment) {
  if (state === 'unknown-priority-sustained') return 750;
  if (state === 'unknown-priority-observed') return 1000;
  if (state === 'no-processes') return 10000;
  if (state === 'incomplete-priority-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { latestUnknownCount: 0, latestUnknownRate: 0 };
}

export function mergeProcessPriorityUnknownLabelReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_ID,
    libraryVersion: PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    processCount: last.processCount || 0,
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    latestUnknownCount: last.latestUnknownCount,
    latestUnknownRate: last.latestUnknownRate,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noProcessCount: validated.reduce((sum, report) => sum + report.noProcessCount, 0),
    unknownSamples: validated.reduce((sum, report) => sum + report.unknownSamples, 0),
    maximumRate: validated.length === 0 ? 0 : Math.max(...validated.map((report) => report.maximumRate)),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildProcessPriorityUnknownLabelPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Unknown-label library clock must return a number');
  return timestamp;
}

export function buildProcessPriorityUnknownLabelEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Unknown-label library trigger is required');
  }
  return Object.freeze({
    library: PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_ID,
    libraryVersion: PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createProcessPriorityUnknownLabelLibrary() {
  return Object.freeze({
    id: PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_ID,
    version: PROCESS_PRIORITY_UNKNOWN_LABEL_LIBRARY_VERSION,
    merge: mergeProcessPriorityUnknownLabelReports,
    plan: buildProcessPriorityUnknownLabelPlan,
    envelope: buildProcessPriorityUnknownLabelEnvelope
  });
}
