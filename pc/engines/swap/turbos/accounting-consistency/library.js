/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated accounting-consistency library. It validates, aggregates, and
 * plans accounting reports without importing the turbo or changing swap.
 */

export const SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_ID = 'swap.accounting-consistency.library';
export const SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'accounting-consistent',
  'accounting-drift',
  'no-swap',
  'no-observation',
  'invalid-accounting-evidence',
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
    throw new RangeError(`Accounting-consistency library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Accounting-consistency library report must be an object');
  if (report.turbo !== 'swap.accounting-consistency') {
    throw new Error('Accounting-consistency library requires an accounting-consistency turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Accounting-consistency library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Accounting-consistency library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['noSwapCount', 'no-swap count'],
    ['consistentCount', 'consistent count'],
    ['driftCount', 'drift count']
  ]) requireCount(report, field, label);
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Accounting-consistency library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Accounting-consistency library reports must be an array');
  if (reports.length > 64) throw new RangeError('Accounting-consistency library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-accounting-evidence')) return 'invalid-accounting-evidence';
  if (reports.some((report) => report.state === 'accounting-drift')) return 'accounting-drift';
  if (reports.every((report) => report.state === 'no-swap')) return 'no-swap';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'accounting-consistent')
    ? 'accounting-consistent' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'invalid-accounting-evidence') return Object.freeze(['review-swap-accounting-sensors']);
  if (state === 'accounting-drift') return Object.freeze(['hold-swap-policy-automation', 'review-sensor-agreement']);
  if (state === 'no-swap') return Object.freeze(['no-change', 'keep-no-swap-user-owned']);
  if (state === 'no-observation') return Object.freeze(['request-swap-accounting-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-swap-accounting-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-accounting-evidence') return 'sensor-review';
  if (state === 'accounting-drift') return 'sensor-agreement-review';
  if (state === 'no-swap') return 'no-swap-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'accounting-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-accounting-evidence') return 500;
  if (state === 'accounting-drift') return 750;
  if (state === 'no-swap') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeSwapAccountingConsistencyReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_ID,
    libraryVersion: SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    noSwapCount: validated.reduce((sum, report) => sum + report.noSwapCount, 0),
    consistentCount: validated.reduce((sum, report) => sum + report.consistentCount, 0),
    driftCount: validated.reduce((sum, report) => sum + report.driftCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildSwapAccountingConsistencyPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Accounting-consistency library clock must return a number');
  return timestamp;
}

export function buildSwapAccountingConsistencyEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Accounting-consistency library trigger is required');
  }
  return Object.freeze({
    library: SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_ID,
    libraryVersion: SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createSwapAccountingConsistencyLibrary() {
  return Object.freeze({
    id: SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_ID,
    version: SWAP_ACCOUNTING_CONSISTENCY_LIBRARY_VERSION,
    merge: mergeSwapAccountingConsistencyReports,
    plan: buildSwapAccountingConsistencyPlan,
    envelope: buildSwapAccountingConsistencyEnvelope
  });
}
