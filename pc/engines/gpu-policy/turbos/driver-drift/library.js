/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated driver-drift library. It validates, aggregates, and plans driver
 * evidence reports without importing the turbo or changing driver policy.
 */

export const GPU_DRIVER_DRIFT_LIBRARY_ID = 'gpu-policy.driver-drift.library';
export const GPU_DRIVER_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'driver-drift',
  'vendor-specific-driver',
  'documented-driver-stable',
  'incomplete-driver-evidence',
  'no-gpu',
  'no-observation',
  'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, lower, upper) {
  return Number.isFinite(value) && value >= lower && value <= upper;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Driver-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Driver-drift library report must be an object');
  if (report.turbo !== 'gpu-policy.driver-drift') {
    throw new Error('Driver-drift library requires a driver-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Driver-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Driver-drift library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['noGpuCount', 'no-GPU count'],
    ['incompleteCount', 'incomplete count'],
    ['changeCount', 'change count'],
    ['reviewCount', 'review count'],
    ['comparisonCount', 'comparison count']
  ]) requireCount(report, field, label);
  if (!Number.isInteger(report.changeThreshold) || report.changeThreshold < 1
    || report.changeThreshold > 64) {
    throw new RangeError('Driver-drift library changeThreshold must be from 1 to 64');
  }
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Driver-drift library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Driver-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Driver-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'incomplete-driver-evidence')) {
    return 'incomplete-driver-evidence';
  }
  if (reports.some((report) => report.state === 'driver-drift')) return 'driver-drift';
  if (reports.some((report) => report.state === 'vendor-specific-driver')) {
    return 'vendor-specific-driver';
  }
  if (reports.every((report) => report.state === 'no-gpu')) return 'no-gpu';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'documented-driver-stable')
    ? 'documented-driver-stable' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'driver-drift') return Object.freeze(['review-driver-change', 'hold-driver-automation']);
  if (state === 'vendor-specific-driver') {
    return Object.freeze(['review-documented-driver-controls-without-change']);
  }
  if (state === 'incomplete-driver-evidence') return Object.freeze(['request-complete-driver-evidence']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-driver-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-driver-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'driver-drift') return 'driver-change-review';
  if (state === 'vendor-specific-driver') return 'driver-documentation-review';
  if (state === 'incomplete-driver-evidence') return 'evidence-bootstrap';
  if (state === 'no-gpu') return 'no-gpu-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-driver-observation';
}

function intervalFor(state, environment) {
  if (state === 'driver-drift') return 750;
  if (state === 'vendor-specific-driver') return 1000;
  if (state === 'incomplete-driver-evidence') return 1500;
  if (state === 'no-gpu') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeGpuDriverDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: GPU_DRIVER_DRIFT_LIBRARY_ID,
    libraryVersion: GPU_DRIVER_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    noGpuCount: validated.reduce((sum, report) => sum + report.noGpuCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0),
    reviewCount: validated.reduce((sum, report) => sum + report.reviewCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildGpuDriverDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: GPU_DRIVER_DRIFT_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0
      ? 0 : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Driver-drift library clock must return a number');
  return timestamp;
}

export function buildGpuDriverDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Driver-drift library trigger is required');
  }
  return Object.freeze({
    library: GPU_DRIVER_DRIFT_LIBRARY_ID,
    libraryVersion: GPU_DRIVER_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createGpuDriverDriftLibrary() {
  return Object.freeze({
    id: GPU_DRIVER_DRIFT_LIBRARY_ID,
    version: GPU_DRIVER_DRIFT_LIBRARY_VERSION,
    merge: mergeGpuDriverDriftReports,
    plan: buildGpuDriverDriftPlan,
    envelope: buildGpuDriverDriftEnvelope
  });
}
