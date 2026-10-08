/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated priority-volatility library. It validates, aggregates, and plans
 * priority-state movement reports without importing the turbo or changing
 * process state.
 */

export const PROCESS_PRIORITY_VOLATILITY_LIBRARY_ID = 'process-priority.priority-volatility.library';
export const PROCESS_PRIORITY_VOLATILITY_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'priority-volatility-sustained', 'priority-volatility-observed',
  'stable-priority-state', 'no-processes', 'incomplete-volatility-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Priority-volatility library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Priority-volatility library report must be an object');
  if (report.turbo !== 'process-priority.priority-volatility') {
    throw new Error('Priority-volatility library requires a priority-volatility turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('Priority-volatility library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Priority-volatility library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Priority-volatility library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.changeThreshold) || report.changeThreshold < 1
    || report.changeThreshold > 64) {
    throw new RangeError('Priority-volatility library changeThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noProcessCount', 'no-process count'], ['volatilityCount', 'volatility count'],
    ['comparisonCount', 'comparison count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.processCount) || report.processCount < 0 || report.processCount > 4096) {
    throw new RangeError('Priority-volatility library processCount must be from 0 to 4096');
  }
  if (report.latestPriorityStateSignature !== null && typeof report.latestPriorityStateSignature !== 'string') {
    throw new TypeError('Priority-volatility library latest signature must be null or a string');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Priority-volatility library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Priority-volatility library reports must be an array');
  if (reports.length > 64) throw new RangeError('Priority-volatility library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-processes')) return 'no-processes';
  if (reports.some((report) => report.state === 'incomplete-volatility-evidence')) {
    return 'incomplete-volatility-evidence';
  }
  if (reports.some((report) => report.state === 'priority-volatility-sustained')) {
    return 'priority-volatility-sustained';
  }
  if (reports.some((report) => report.state === 'priority-volatility-observed')) {
    return 'priority-volatility-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-priority-state';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-priority-state-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-volatility-review']);
  if (state === 'incomplete-volatility-evidence') {
    return Object.freeze(['request-complete-priority-state-evidence']);
  }
  if (state === 'priority-volatility-sustained') {
    return Object.freeze(['review-priority-state-volatility', 'hold-unapproved-priority-policy']);
  }
  if (state === 'priority-volatility-observed') return Object.freeze(['observe-next-priority-state']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'priority-volatility-sustained') return 'priority-volatility-review';
  if (state === 'priority-volatility-observed') return 'priority-volatility-observation';
  if (state === 'no-processes') return 'no-process-observation';
  if (state === 'incomplete-volatility-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-priority-state-observation';
}

function intervalFor(state, environment) {
  if (state === 'priority-volatility-sustained') return 750;
  if (state === 'priority-volatility-observed') return 1000;
  if (state === 'no-processes') return 10000;
  if (state === 'incomplete-volatility-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latestSignature(reports) {
  const latest = reports.at(-1);
  return latest ? latest.latestPriorityStateSignature : null;
}

export function mergeProcessPriorityVolatilityReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const latest = validated.at(-1);
  return Object.freeze({
    library: PROCESS_PRIORITY_VOLATILITY_LIBRARY_ID,
    libraryVersion: PROCESS_PRIORITY_VOLATILITY_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    processCount: latest ? latest.processCount : 0,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noProcessCount: validated.reduce((sum, report) => sum + report.noProcessCount, 0),
    volatilityCount: validated.reduce((sum, report) => sum + report.volatilityCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    latestPriorityStateSignature: latestSignature(validated),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildProcessPriorityVolatilityPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: PROCESS_PRIORITY_VOLATILITY_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Priority-volatility library clock must return a number');
  return timestamp;
}

export function buildProcessPriorityVolatilityEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Priority-volatility library trigger is required');
  }
  return Object.freeze({
    library: PROCESS_PRIORITY_VOLATILITY_LIBRARY_ID,
    libraryVersion: PROCESS_PRIORITY_VOLATILITY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createProcessPriorityVolatilityLibrary() {
  return Object.freeze({
    id: PROCESS_PRIORITY_VOLATILITY_LIBRARY_ID,
    version: PROCESS_PRIORITY_VOLATILITY_LIBRARY_VERSION,
    merge: mergeProcessPriorityVolatilityReports,
    plan: buildProcessPriorityVolatilityPlan,
    envelope: buildProcessPriorityVolatilityEnvelope
  });
}
