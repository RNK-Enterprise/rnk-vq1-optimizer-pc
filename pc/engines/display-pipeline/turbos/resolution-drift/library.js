/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated resolution-drift library. It validates, aggregates, and plans
 * resolution reports without importing the turbo or changing display policy.
 */

export const DISPLAY_RESOLUTION_DRIFT_LIBRARY_ID = 'display-pipeline.resolution-drift.library';
export const DISPLAY_RESOLUTION_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'resolution-drift-sustained', 'resolution-drift-observed', 'stable-resolution',
  'no-display', 'no-observation', 'incomplete-resolution-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Resolution-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Resolution-drift library report must be an object');
  if (report.turbo !== 'display-pipeline.resolution-drift') {
    throw new Error('Resolution-drift library requires a resolution-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Resolution-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Resolution-drift library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Resolution-drift library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.changeThreshold) || report.changeThreshold < 1
    || report.changeThreshold > 64) {
    throw new RangeError('Resolution-drift library changeThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noDisplayCount', 'no-display count'], ['noObservationCount', 'no-observation count'],
    ['transitionCount', 'transition count'], ['comparisonCount', 'comparison count']
  ]) requireCount(report, field, label);
  if (report.latestResolution !== null && typeof report.latestResolution !== 'string') {
    throw new TypeError('Resolution-drift library latestResolution must be a string or null');
  }
  for (const field of ['latestWidth', 'latestHeight']) {
    if (report[field] !== null && !positiveInteger(report[field])) {
      throw new RangeError(`Resolution-drift library ${field} must be a positive integer or null`);
    }
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Resolution-drift library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Resolution-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Resolution-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-display')) return 'no-display';
  if (reports.some((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.some((report) => report.state === 'incomplete-resolution-evidence')) {
    return 'incomplete-resolution-evidence';
  }
  if (reports.some((report) => report.state === 'resolution-drift-sustained')) {
    return 'resolution-drift-sustained';
  }
  if (reports.some((report) => report.state === 'resolution-drift-observed')) {
    return 'resolution-drift-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-resolution';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  const byState = {
    'insufficient-data': ['collect-more-resolution-samples'],
    'no-display': ['keep-display-controls-disabled'],
    'no-observation': ['request-resolution-observation'],
    'incomplete-resolution-evidence': ['request-complete-resolution-evidence'],
    'resolution-drift-sustained': ['review-resolution-workload', 'hold-unapproved-display-policy'],
    'resolution-drift-observed': ['observe-next-resolution-sample'],
    'stable-resolution': ['no-change']
  };
  return Object.freeze(byState[state]);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'resolution-drift-sustained') return 'resolution-review';
  if (state === 'resolution-drift-observed') return 'resolution-observation';
  if (state === 'no-display') return 'no-display-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'incomplete-resolution-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-resolution-observation';
}

function intervalFor(state, environment) {
  if (state === 'resolution-drift-sustained') return 750;
  if (state === 'resolution-drift-observed') return 1000;
  if (state === 'no-display') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'incomplete-resolution-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports, field, fallback) {
  const value = reports.at(-1)?.[field];
  return value === undefined ? fallback : value;
}

export function mergeDisplayResolutionDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: DISPLAY_RESOLUTION_DRIFT_LIBRARY_ID,
    libraryVersion: DISPLAY_RESOLUTION_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDisplayCount: validated.reduce((sum, report) => sum + report.noDisplayCount, 0),
    noObservationCount: validated.reduce((sum, report) => sum + report.noObservationCount, 0),
    transitionCount: validated.reduce((sum, report) => sum + report.transitionCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    latestResolution: latest(validated, 'latestResolution', null),
    latestWidth: latest(validated, 'latestWidth', null),
    latestHeight: latest(validated, 'latestHeight', null),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildDisplayResolutionDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: DISPLAY_RESOLUTION_DRIFT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Resolution-drift library clock must return a number');
  return timestamp;
}

export function buildDisplayResolutionDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Resolution-drift library trigger is required');
  }
  return Object.freeze({
    library: DISPLAY_RESOLUTION_DRIFT_LIBRARY_ID,
    libraryVersion: DISPLAY_RESOLUTION_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createDisplayResolutionDriftLibrary() {
  return Object.freeze({
    id: DISPLAY_RESOLUTION_DRIFT_LIBRARY_ID,
    version: DISPLAY_RESOLUTION_DRIFT_LIBRARY_VERSION,
    merge: mergeDisplayResolutionDriftReports,
    plan: buildDisplayResolutionDriftPlan,
    envelope: buildDisplayResolutionDriftEnvelope
  });
}
