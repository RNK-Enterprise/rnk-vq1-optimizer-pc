/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated headroom-collapse library. It validates, aggregates, and plans
 * headroom movement reports without importing the turbo or changing swap.
 */

export const SWAP_HEADROOM_COLLAPSE_LIBRARY_ID = 'swap.headroom-collapse.library';
export const SWAP_HEADROOM_COLLAPSE_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'headroom-collapse',
  'headroom-recovery',
  'stable-headroom',
  'no-swap',
  'no-observation',
  'invalid-headroom-evidence',
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
    throw new RangeError(`Headroom-collapse library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Headroom-collapse library report must be an object');
  if (report.turbo !== 'swap.headroom-collapse') {
    throw new Error('Headroom-collapse library requires a headroom-collapse turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Headroom-collapse library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Headroom-collapse library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['noSwapCount', 'no-swap count'],
    ['collapseCount', 'collapse count'],
    ['recoveryCount', 'recovery count'],
    ['comparisonCount', 'comparison count']
  ]) requireCount(report, field, label);
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Headroom-collapse library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Headroom-collapse library reports must be an array');
  if (reports.length > 64) throw new RangeError('Headroom-collapse library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-headroom-evidence')) return 'invalid-headroom-evidence';
  if (reports.some((report) => report.state === 'headroom-collapse')) return 'headroom-collapse';
  if (reports.some((report) => report.state === 'headroom-recovery')) return 'headroom-recovery';
  if (reports.every((report) => report.state === 'no-swap')) return 'no-swap';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'stable-headroom')
    ? 'stable-headroom' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'invalid-headroom-evidence') return Object.freeze(['review-swap-capacity-sensor-range']);
  if (state === 'headroom-collapse') return Object.freeze(['hold-destructive-actions', 'observe-swap-headroom']);
  if (state === 'headroom-recovery') return Object.freeze(['observe-swap-headroom-recovery']);
  if (state === 'no-swap') return Object.freeze(['no-change', 'keep-no-swap-user-owned']);
  if (state === 'no-observation') return Object.freeze(['request-swap-headroom-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-swap-headroom-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-headroom-evidence') return 'sensor-review';
  if (state === 'headroom-collapse') return 'headroom-protection';
  if (state === 'headroom-recovery') return 'recovery-observation';
  if (state === 'no-swap') return 'no-swap-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-headroom-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-headroom-evidence') return 500;
  if (state === 'headroom-collapse') return 750;
  if (state === 'headroom-recovery') return 1250;
  if (state === 'no-swap') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeSwapHeadroomCollapseReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: SWAP_HEADROOM_COLLAPSE_LIBRARY_ID,
    libraryVersion: SWAP_HEADROOM_COLLAPSE_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    noSwapCount: validated.reduce((sum, report) => sum + report.noSwapCount, 0),
    collapseCount: validated.reduce((sum, report) => sum + report.collapseCount, 0),
    recoveryCount: validated.reduce((sum, report) => sum + report.recoveryCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildSwapHeadroomCollapsePlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: SWAP_HEADROOM_COLLAPSE_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Headroom-collapse library clock must return a number');
  return timestamp;
}

export function buildSwapHeadroomCollapseEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Headroom-collapse library trigger is required');
  }
  return Object.freeze({
    library: SWAP_HEADROOM_COLLAPSE_LIBRARY_ID,
    libraryVersion: SWAP_HEADROOM_COLLAPSE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createSwapHeadroomCollapseLibrary() {
  return Object.freeze({
    id: SWAP_HEADROOM_COLLAPSE_LIBRARY_ID,
    version: SWAP_HEADROOM_COLLAPSE_LIBRARY_VERSION,
    merge: mergeSwapHeadroomCollapseReports,
    plan: buildSwapHeadroomCollapsePlan,
    envelope: buildSwapHeadroomCollapseEnvelope
  });
}
