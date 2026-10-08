/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated refresh-drift library. It validates, aggregates, and plans
 * refresh reports without importing the turbo or changing display policy.
 */

export const DISPLAY_REFRESH_DRIFT_LIBRARY_ID = 'display-pipeline.refresh-drift.library';
export const DISPLAY_REFRESH_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'refresh-drift-sustained', 'refresh-drift-observed', 'stable-refresh',
  'no-display', 'no-observation', 'incomplete-refresh-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Refresh-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Refresh-drift library report must be an object');
  if (report.turbo !== 'display-pipeline.refresh-drift') {
    throw new Error('Refresh-drift library requires a refresh-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Refresh-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Refresh-drift library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Refresh-drift library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.changeThreshold) || report.changeThreshold < 1
    || report.changeThreshold > 64) {
    throw new RangeError('Refresh-drift library changeThreshold must be from 1 to 64');
  }
  if (!nonNegative(report.deltaThreshold)) {
    throw new RangeError('Refresh-drift library deltaThreshold must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noDisplayCount', 'no-display count'], ['noObservationCount', 'no-observation count'],
    ['deltaCount', 'delta count'], ['comparisonCount', 'comparison count']
  ]) requireCount(report, field, label);
  for (const [field, label] of [['maximumDelta', 'maximumDelta'], ['latestRefreshRateHz', 'latestRefreshRateHz']]) {
    if (report[field] !== null && !nonNegative(report[field])) {
      throw new RangeError(`Refresh-drift library ${label} must be null or non-negative`);
    }
  }
  if (!nonNegative(report.confidence) || report.confidence > 1) {
    throw new RangeError('Refresh-drift library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Refresh-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Refresh-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-display')) return 'no-display';
  if (reports.some((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.some((report) => report.state === 'incomplete-refresh-evidence')) {
    return 'incomplete-refresh-evidence';
  }
  if (reports.some((report) => report.state === 'refresh-drift-sustained')) {
    return 'refresh-drift-sustained';
  }
  if (reports.some((report) => report.state === 'refresh-drift-observed')) {
    return 'refresh-drift-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-refresh';
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
    'insufficient-data': ['collect-more-refresh-samples'],
    'no-display': ['keep-display-controls-disabled'],
    'no-observation': ['request-refresh-observation'],
    'incomplete-refresh-evidence': ['request-complete-refresh-evidence'],
    'refresh-drift-sustained': ['review-refresh-stability', 'hold-unapproved-display-policy'],
    'refresh-drift-observed': ['observe-next-refresh-sample'],
    'stable-refresh': ['no-change']
  };
  return Object.freeze(byState[state]);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'refresh-drift-sustained') return 'refresh-review';
  if (state === 'refresh-drift-observed') return 'refresh-observation';
  if (state === 'no-display') return 'no-display-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'incomplete-refresh-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-refresh-observation';
}

function intervalFor(state, environment) {
  if (state === 'refresh-drift-sustained') return 750;
  if (state === 'refresh-drift-observed') return 1000;
  if (state === 'no-display') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'incomplete-refresh-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeDisplayRefreshDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const latest = validated.at(-1);
  return Object.freeze({
    library: DISPLAY_REFRESH_DRIFT_LIBRARY_ID,
    libraryVersion: DISPLAY_REFRESH_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDisplayCount: validated.reduce((sum, report) => sum + report.noDisplayCount, 0),
    noObservationCount: validated.reduce((sum, report) => sum + report.noObservationCount, 0),
    deltaCount: validated.reduce((sum, report) => sum + report.deltaCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    maximumDelta: validated.length === 0 ? 0
      : Math.max(...validated.map((report) => report.maximumDelta ?? 0)),
    latestRefreshRateHz: latest?.latestRefreshRateHz ?? null,
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildDisplayRefreshDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: DISPLAY_REFRESH_DRIFT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Refresh-drift library clock must return a number');
  return timestamp;
}

export function buildDisplayRefreshDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Refresh-drift library trigger is required');
  }
  return Object.freeze({
    library: DISPLAY_REFRESH_DRIFT_LIBRARY_ID,
    libraryVersion: DISPLAY_REFRESH_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createDisplayRefreshDriftLibrary() {
  return Object.freeze({
    id: DISPLAY_REFRESH_DRIFT_LIBRARY_ID,
    version: DISPLAY_REFRESH_DRIFT_LIBRARY_VERSION,
    merge: mergeDisplayRefreshDriftReports,
    plan: buildDisplayRefreshDriftPlan,
    envelope: buildDisplayRefreshDriftEnvelope
  });
}
