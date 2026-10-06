/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated availability-drift library. It validates, aggregates, and plans
 * capacity movement reports without importing the turbo or changing swap.
 */

export const SWAP_AVAILABILITY_DRIFT_LIBRARY_ID = 'swap.availability-drift.library';
export const SWAP_AVAILABILITY_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'availability-drift',
  'capacity-loss',
  'capacity-gain',
  'stable-availability',
  'no-swap',
  'no-observation',
  'invalid-availability-evidence',
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
    throw new RangeError(`Availability-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Availability-drift library report must be an object');
  if (report.turbo !== 'swap.availability-drift') {
    throw new Error('Availability-drift library requires an availability-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Availability-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Availability-drift library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['noneCount', 'no-swap count'],
    ['increaseCount', 'increase count'],
    ['decreaseCount', 'decrease count'],
    ['availabilityChanges', 'availability change count'],
    ['comparisonCount', 'comparison count']
  ]) requireCount(report, field, label);
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Availability-drift library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Availability-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Availability-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-availability-evidence')) return 'invalid-availability-evidence';
  if (reports.some((report) => report.state === 'availability-drift')) return 'availability-drift';
  if (reports.some((report) => report.state === 'capacity-loss')) return 'capacity-loss';
  if (reports.some((report) => report.state === 'capacity-gain')) return 'capacity-gain';
  if (reports.every((report) => report.state === 'no-swap')) return 'no-swap';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'stable-availability')
    ? 'stable-availability' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'invalid-availability-evidence') return Object.freeze(['review-swap-capacity-sensor-range']);
  if (state === 'availability-drift') return Object.freeze(['review-swap-availability-change', 'hold-automatic-creation']);
  if (state === 'capacity-loss') return Object.freeze(['review-swap-capacity-loss']);
  if (state === 'capacity-gain') return Object.freeze(['observe-new-swap-capacity']);
  if (state === 'no-swap') return Object.freeze(['no-change', 'keep-no-swap-user-owned']);
  if (state === 'no-observation') return Object.freeze(['request-swap-availability-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-swap-availability-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-availability-evidence') return 'sensor-review';
  if (state === 'availability-drift') return 'availability-review';
  if (state === 'capacity-loss') return 'capacity-loss-review';
  if (state === 'capacity-gain') return 'capacity-gain-observation';
  if (state === 'no-swap') return 'no-swap-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'availability-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-availability-evidence') return 500;
  if (state === 'availability-drift') return 750;
  if (state === 'capacity-loss') return 1000;
  if (state === 'capacity-gain') return 1500;
  if (state === 'no-swap') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeSwapAvailabilityDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: SWAP_AVAILABILITY_DRIFT_LIBRARY_ID,
    libraryVersion: SWAP_AVAILABILITY_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    noneCount: validated.reduce((sum, report) => sum + report.noneCount, 0),
    increaseCount: validated.reduce((sum, report) => sum + report.increaseCount, 0),
    decreaseCount: validated.reduce((sum, report) => sum + report.decreaseCount, 0),
    availabilityChanges: validated.reduce((sum, report) => sum + report.availabilityChanges, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildSwapAvailabilityDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: SWAP_AVAILABILITY_DRIFT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Availability-drift library clock must return a number');
  return timestamp;
}

export function buildSwapAvailabilityDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Availability-drift library trigger is required');
  }
  return Object.freeze({
    library: SWAP_AVAILABILITY_DRIFT_LIBRARY_ID,
    libraryVersion: SWAP_AVAILABILITY_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createSwapAvailabilityDriftLibrary() {
  return Object.freeze({
    id: SWAP_AVAILABILITY_DRIFT_LIBRARY_ID,
    version: SWAP_AVAILABILITY_DRIFT_LIBRARY_VERSION,
    merge: mergeSwapAvailabilityDriftReports,
    plan: buildSwapAvailabilityDriftPlan,
    envelope: buildSwapAvailabilityDriftEnvelope
  });
}
