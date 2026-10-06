/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated pressure-dwell library. It validates, aggregates, and plans
 * pressure persistence reports without importing the turbo or changing swap.
 */

export const SWAP_PRESSURE_DWELL_LIBRARY_ID = 'swap.pressure-dwell.library';
export const SWAP_PRESSURE_DWELL_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'sustained-high',
  'sustained-elevated',
  'transient-or-normal',
  'invalid-pressure-evidence',
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
    throw new RangeError(`Pressure-dwell library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Pressure-dwell library report must be an object');
  if (report.turbo !== 'swap.pressure-dwell') {
    throw new Error('Pressure-dwell library requires a pressure-dwell turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Pressure-dwell library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Pressure-dwell library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['highCount', 'high count'],
    ['elevatedCount', 'elevated count']
  ]) requireCount(report, field, label);
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Pressure-dwell library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Pressure-dwell library reports must be an array');
  if (reports.length > 64) throw new RangeError('Pressure-dwell library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-pressure-evidence')) return 'invalid-pressure-evidence';
  if (reports.some((report) => report.state === 'sustained-high')) return 'sustained-high';
  if (reports.some((report) => report.state === 'sustained-elevated')) return 'sustained-elevated';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'transient-or-normal')
    ? 'transient-or-normal' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'invalid-pressure-evidence') return Object.freeze(['review-swap-sensor-range']);
  if (state === 'sustained-high') return Object.freeze(['hold-destructive-actions', 'review-memory-pressure']);
  if (state === 'sustained-elevated') return Object.freeze(['observe-next-swap-sample', 'review-documented-swap-policy']);
  if (state === 'no-observation') return Object.freeze(['request-swap-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-swap-pressure-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-pressure-evidence') return 'sensor-review';
  if (state === 'sustained-high') return 'pressure-protection';
  if (state === 'sustained-elevated') return 'elevated-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-pressure-evidence') return 500;
  if (state === 'sustained-high') return 750;
  if (state === 'sustained-elevated') return 1000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeSwapPressureDwellReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: SWAP_PRESSURE_DWELL_LIBRARY_ID,
    libraryVersion: SWAP_PRESSURE_DWELL_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    highCount: validated.reduce((sum, report) => sum + report.highCount, 0),
    elevatedCount: validated.reduce((sum, report) => sum + report.elevatedCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildSwapPressureDwellPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: SWAP_PRESSURE_DWELL_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Pressure-dwell library clock must return a number');
  return timestamp;
}

export function buildSwapPressureDwellEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Pressure-dwell library trigger is required');
  }
  return Object.freeze({
    library: SWAP_PRESSURE_DWELL_LIBRARY_ID,
    libraryVersion: SWAP_PRESSURE_DWELL_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createSwapPressureDwellLibrary() {
  return Object.freeze({
    id: SWAP_PRESSURE_DWELL_LIBRARY_ID,
    version: SWAP_PRESSURE_DWELL_LIBRARY_VERSION,
    merge: mergeSwapPressureDwellReports,
    plan: buildSwapPressureDwellPlan,
    envelope: buildSwapPressureDwellEnvelope
  });
}
