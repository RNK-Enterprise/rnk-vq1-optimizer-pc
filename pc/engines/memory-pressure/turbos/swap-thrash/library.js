/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated swap-thrash turbo library. It validates, aggregates, and plans
 * swap reports without importing the turbo or operating-system API.
 */

export const MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_ID = 'memory-pressure.swap-thrash.library';
export const MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-swap',
  'rising-swap',
  'volatile-swap',
  'reclaim-churn',
  'active-thrash',
  'invalid-swap-evidence',
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

function optionalBounded(value, lower, upper, label) {
  if (value === null) return null;
  if (!bounded(value, lower, upper)) {
    throw new RangeError(`Swap-thrash library ${label} is outside its bounded range`);
  }
  return value;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Swap-thrash library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Swap-thrash library report must be an object');
  if (report.turbo !== 'memory-pressure.swap-thrash') {
    throw new Error('Swap-thrash library requires a swap-thrash turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Swap-thrash library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Swap-thrash library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['activeCount', 'active count'],
    ['reclaimCount', 'reclaim count'],
    ['growthCount', 'growth count'],
    ['comparisonCount', 'comparison count'],
    ['reversalCount', 'reversal count']
  ]) requireCount(report, field, label);
  optionalBounded(report.averageAbsoluteDelta, 0, 100, 'averageAbsoluteDelta');
  optionalBounded(report.slope, -100, 100, 'slope');
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Swap-thrash library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Swap-thrash library reports must be an array');
  if (reports.length > 64) throw new RangeError('Swap-thrash library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-swap-evidence')) return 'invalid-swap-evidence';
  if (reports.some((report) => report.state === 'active-thrash')) return 'active-thrash';
  if (reports.some((report) => report.state === 'reclaim-churn')) return 'reclaim-churn';
  if (reports.some((report) => report.state === 'rising-swap')) return 'rising-swap';
  if (reports.some((report) => report.state === 'volatile-swap')) return 'volatile-swap';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'stable-swap')
    ? 'stable-swap' : 'insufficient-data';
}

function weightedAverage(reports, selector) {
  const usable = reports.filter((report) => selector(report) !== null);
  if (usable.length === 0) return null;
  const totalWeight = usable.reduce((sum, report) => sum + Math.max(1, report.observedCount), 0);
  const total = usable.reduce((sum, report) => (
    sum + selector(report) * Math.max(1, report.observedCount)
  ), 0);
  return Math.round((total / totalWeight) * 10000) / 10000;
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'invalid-swap-evidence') return Object.freeze(['review-swap-sensor-range']);
  if (state === 'active-thrash') return Object.freeze(['review-memory-pressure-before-swap-control']);
  if (state === 'reclaim-churn') return Object.freeze(['observe-reclaim-activity']);
  if (state === 'rising-swap') return Object.freeze(['observe-swap-growth']);
  if (state === 'volatile-swap') return Object.freeze(['observe-swap-stability']);
  if (state === 'no-observation') return Object.freeze(['request-swap-activity-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-swap-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-swap-evidence') return 'sensor-review';
  if (state === 'active-thrash') return 'pressure-review';
  if (state === 'reclaim-churn') return 'reclaim-observation';
  if (state === 'rising-swap') return 'growth-observation';
  if (state === 'volatile-swap') return 'stability-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-swap-evidence') return 500;
  if (state === 'active-thrash') return 750;
  if (state === 'reclaim-churn') return 1000;
  if (state === 'rising-swap') return 1000;
  if (state === 'volatile-swap') return 750;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeMemoryPressureSwapThrashReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_ID,
    libraryVersion: MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    activeCount: validated.reduce((sum, report) => sum + report.activeCount, 0),
    reclaimCount: validated.reduce((sum, report) => sum + report.reclaimCount, 0),
    growthCount: validated.reduce((sum, report) => sum + report.growthCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    reversalCount: validated.reduce((sum, report) => sum + report.reversalCount, 0),
    averageAbsoluteDelta: weightedAverage(validated, (report) => report.averageAbsoluteDelta),
    slope: weightedAverage(validated, (report) => report.slope),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildMemoryPressureSwapThrashPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Swap-thrash library clock must return a number');
  return timestamp;
}

export function buildMemoryPressureSwapThrashEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Swap-thrash library trigger is required');
  }
  return Object.freeze({
    library: MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_ID,
    libraryVersion: MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createMemoryPressureSwapThrashLibrary() {
  return Object.freeze({
    id: MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_ID,
    version: MEMORY_PRESSURE_SWAP_THRASH_LIBRARY_VERSION,
    merge: mergeMemoryPressureSwapThrashReports,
    plan: buildMemoryPressureSwapThrashPlan,
    envelope: buildMemoryPressureSwapThrashEnvelope
  });
}
