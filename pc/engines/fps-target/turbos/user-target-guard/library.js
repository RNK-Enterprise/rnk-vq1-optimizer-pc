/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated user-target guard library. It validates, aggregates, and plans
 * explicit user-target reports without importing the turbo or changing policy.
 */

export const FPS_USER_TARGET_GUARD_LIBRARY_ID = 'fps-target.user-target-guard.library';
export const FPS_USER_TARGET_GUARD_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'target-over-refresh-sustained', 'target-over-refresh-observed', 'target-without-display',
  'user-target-preserved', 'no-user-target', 'no-display', 'no-observation',
  'incomplete-user-target-evidence', 'insufficient-data'
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
    throw new RangeError(`User-target guard library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireMetric(value, label) {
  if (value !== null && !nonNegative(value)) {
    throw new RangeError(`User-target guard library ${label} must be null or non-negative`);
  }
  return value;
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('User-target guard library report must be an object');
  if (report.turbo !== 'fps-target.user-target-guard') {
    throw new Error('User-target guard library requires a user-target guard turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('User-target guard library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('User-target guard library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('User-target guard library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('User-target guard library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['missingCount', 'missing count'],
    ['incompleteCount', 'incomplete count'], ['noDisplayCount', 'no-display count'],
    ['noObservationCount', 'no-observation count'], ['withoutDisplayCount', 'without-display count'],
    ['overRefreshCount', 'over-refresh count']
  ]) requireCount(report, field, label);
  requireMetric(report.minimumUserTarget, 'minimumUserTarget');
  requireMetric(report.maximumUserTarget, 'maximumUserTarget');
  if (!nonNegative(report.confidence) || report.confidence > 1) {
    throw new RangeError('User-target guard library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('User-target guard library reports must be an array');
  if (reports.length > 64) throw new RangeError('User-target guard library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-display')) return 'no-display';
  if (reports.some((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.some((report) => report.state === 'incomplete-user-target-evidence')) {
    return 'incomplete-user-target-evidence';
  }
  if (reports.every((report) => report.state === 'no-user-target')) return 'no-user-target';
  if (reports.some((report) => report.state === 'target-without-display')) {
    return 'target-without-display';
  }
  if (reports.some((report) => report.state === 'target-over-refresh-sustained')) {
    return 'target-over-refresh-sustained';
  }
  if (reports.some((report) => report.state === 'target-over-refresh-observed')) {
    return 'target-over-refresh-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'user-target-preserved';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-user-target-samples']);
  if (state === 'no-display') return Object.freeze(['keep-fps-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['keep-user-target-observation-disabled']);
  if (state === 'incomplete-user-target-evidence') {
    return Object.freeze(['request-complete-user-target-evidence']);
  }
  if (state === 'no-user-target') return Object.freeze(['preserve-no-user-target-state']);
  if (state === 'target-without-display') {
    return Object.freeze(['observe-display-before-comparing-target']);
  }
  if (state === 'target-over-refresh-sustained') {
    return Object.freeze(['review-user-target-against-refresh', 'preserve-user-intent']);
  }
  if (state === 'target-over-refresh-observed') return Object.freeze(['observe-next-user-target']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'target-over-refresh-sustained') return 'user-target-review';
  if (state === 'target-over-refresh-observed') return 'user-target-observation';
  if (state === 'target-without-display') return 'display-bootstrap';
  if (state === 'no-user-target') return 'no-user-target-observation';
  if (state === 'no-display') return 'no-display-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'incomplete-user-target-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'preserved-target-observation';
}

function intervalFor(state, environment) {
  if (state === 'target-over-refresh-sustained') return 750;
  if (state === 'target-over-refresh-observed') return 1000;
  if (state === 'target-without-display') return 2000;
  if (state === 'no-user-target') return 5000;
  if (state === 'no-display') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'incomplete-user-target-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function extrema(reports, field, reducer, fallback) {
  const values = reports.map((report) => report[field]).filter((value) => value !== null);
  return values.length === 0 ? fallback : reducer(...values);
}

export function mergeFpsUserTargetGuardReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: FPS_USER_TARGET_GUARD_LIBRARY_ID,
    libraryVersion: FPS_USER_TARGET_GUARD_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    missingCount: validated.reduce((sum, report) => sum + report.missingCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDisplayCount: validated.reduce((sum, report) => sum + report.noDisplayCount, 0),
    noObservationCount: validated.reduce((sum, report) => sum + report.noObservationCount, 0),
    withoutDisplayCount: validated.reduce((sum, report) => sum + report.withoutDisplayCount, 0),
    overRefreshCount: validated.reduce((sum, report) => sum + report.overRefreshCount, 0),
    minimumUserTarget: extrema(validated, 'minimumUserTarget', Math.min, null),
    maximumUserTarget: extrema(validated, 'maximumUserTarget', Math.max, null),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildFpsUserTargetGuardPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: FPS_USER_TARGET_GUARD_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('User-target guard library clock must return a number');
  }
  return timestamp;
}

export function buildFpsUserTargetGuardEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('User-target guard library trigger is required');
  }
  return Object.freeze({
    library: FPS_USER_TARGET_GUARD_LIBRARY_ID,
    libraryVersion: FPS_USER_TARGET_GUARD_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createFpsUserTargetGuardLibrary() {
  return Object.freeze({
    id: FPS_USER_TARGET_GUARD_LIBRARY_ID,
    version: FPS_USER_TARGET_GUARD_LIBRARY_VERSION,
    merge: mergeFpsUserTargetGuardReports,
    plan: buildFpsUserTargetGuardPlan,
    envelope: buildFpsUserTargetGuardEnvelope
  });
}
