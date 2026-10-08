/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated target-source drift library. It validates, aggregates, and plans
 * target provenance reports without importing the turbo or applying FPS policy.
 */

export const FPS_TARGET_SOURCE_DRIFT_LIBRARY_ID = 'fps-target.target-source-drift.library';
export const FPS_TARGET_SOURCE_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'source-drift-sustained', 'source-drift-observed', 'stable-target-source',
  'no-display', 'no-observation', 'incomplete-target-evidence', 'insufficient-data'
]);
const SOURCES = Object.freeze(['user', 'display', 'observation', 'unavailable']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Target-source drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Target-source drift library report must be an object');
  if (report.turbo !== 'fps-target.target-source-drift') {
    throw new Error('Target-source drift library requires a target-source drift turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('Target-source drift library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Target-source drift library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Target-source drift library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.changeThreshold) || report.changeThreshold < 1
    || report.changeThreshold > 64) {
    throw new RangeError('Target-source drift library changeThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noDisplayCount', 'no-display count'], ['noObservationCount', 'no-observation count'],
    ['userCount', 'user count'], ['displayCount', 'display count'],
    ['observationCount', 'observation count'], ['transitionCount', 'transition count'],
    ['comparisonCount', 'comparison count']
  ]) requireCount(report, field, label);
  if (!SOURCES.includes(report.latestSource)) {
    throw new Error('Target-source drift library report has an invalid latest source');
  }
  if (report.latestTarget !== null && !nonNegative(report.latestTarget)) {
    throw new RangeError('Target-source drift library latestTarget must be null or non-negative');
  }
  if (!nonNegative(report.confidence) || report.confidence > 1) {
    throw new RangeError('Target-source drift library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Target-source drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Target-source drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-display')) return 'no-display';
  if (reports.some((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.some((report) => report.state === 'incomplete-target-evidence')) {
    return 'incomplete-target-evidence';
  }
  if (reports.some((report) => report.state === 'source-drift-sustained')) {
    return 'source-drift-sustained';
  }
  if (reports.some((report) => report.state === 'source-drift-observed')) {
    return 'source-drift-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-target-source';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-target-source-samples']);
  if (state === 'no-display') return Object.freeze(['keep-fps-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-fps-target-observation']);
  if (state === 'incomplete-target-evidence') return Object.freeze(['request-target-source-evidence']);
  if (state === 'source-drift-sustained') {
    return Object.freeze(['review-target-provenance', 'hold-unapproved-fps-policy']);
  }
  if (state === 'source-drift-observed') return Object.freeze(['observe-next-target-source']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'source-drift-sustained') return 'target-source-review';
  if (state === 'source-drift-observed') return 'target-source-observation';
  if (state === 'no-display') return 'no-display-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'incomplete-target-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-target-source-observation';
}

function intervalFor(state, environment) {
  if (state === 'source-drift-sustained') return 750;
  if (state === 'source-drift-observed') return 1000;
  if (state === 'no-display') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'incomplete-target-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latestTarget(reports) {
  const latest = reports.at(-1);
  return latest ? latest.latestTarget : null;
}

function latestSource(reports) {
  const latest = reports.at(-1);
  return latest ? latest.latestSource : 'unavailable';
}

export function mergeFpsTargetSourceDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: FPS_TARGET_SOURCE_DRIFT_LIBRARY_ID,
    libraryVersion: FPS_TARGET_SOURCE_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDisplayCount: validated.reduce((sum, report) => sum + report.noDisplayCount, 0),
    noObservationCount: validated.reduce((sum, report) => sum + report.noObservationCount, 0),
    userCount: validated.reduce((sum, report) => sum + report.userCount, 0),
    displayCount: validated.reduce((sum, report) => sum + report.displayCount, 0),
    observationCount: validated.reduce((sum, report) => sum + report.observationCount, 0),
    transitionCount: validated.reduce((sum, report) => sum + report.transitionCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    latestSource: latestSource(validated),
    latestTarget: latestTarget(validated),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildFpsTargetSourceDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: FPS_TARGET_SOURCE_DRIFT_LIBRARY_ID,
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
    throw new TypeError('Target-source drift library clock must return a number');
  }
  return timestamp;
}

export function buildFpsTargetSourceDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Target-source drift library trigger is required');
  }
  return Object.freeze({
    library: FPS_TARGET_SOURCE_DRIFT_LIBRARY_ID,
    libraryVersion: FPS_TARGET_SOURCE_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createFpsTargetSourceDriftLibrary() {
  return Object.freeze({
    id: FPS_TARGET_SOURCE_DRIFT_LIBRARY_ID,
    version: FPS_TARGET_SOURCE_DRIFT_LIBRARY_VERSION,
    merge: mergeFpsTargetSourceDriftReports,
    plan: buildFpsTargetSourceDriftPlan,
    envelope: buildFpsTargetSourceDriftEnvelope
  });
}
