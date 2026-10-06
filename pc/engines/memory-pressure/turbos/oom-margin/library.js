/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated OOM-margin turbo library. It validates, aggregates, and plans
 * composite margin reports without importing the turbo or operating-system API.
 */

export const MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_ID = 'memory-pressure.oom-margin.library';
export const MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'safe-margin',
  'converging-margin',
  'narrow-margin',
  'critical-margin',
  'invalid-margin-evidence',
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
    throw new RangeError(`OOM-margin library ${label} is outside its bounded range`);
  }
  return value;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`OOM-margin library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('OOM-margin library report must be an object');
  if (report.turbo !== 'memory-pressure.oom-margin') {
    throw new Error('OOM-margin library requires an oom-margin turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('OOM-margin library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('OOM-margin library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['criticalCount', 'critical count'],
    ['narrowCount', 'narrow count']
  ]) requireCount(report, field, label);
  optionalBounded(report.meanMargin, 0, 100, 'meanMargin');
  optionalBounded(report.minimumMargin, 0, 100, 'minimumMargin');
  optionalBounded(report.slope, -100, 100, 'slope');
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('OOM-margin library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('OOM-margin library reports must be an array');
  if (reports.length > 64) throw new RangeError('OOM-margin library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-margin-evidence')) return 'invalid-margin-evidence';
  if (reports.some((report) => report.state === 'critical-margin')) return 'critical-margin';
  if (reports.some((report) => report.state === 'narrow-margin')) return 'narrow-margin';
  if (reports.some((report) => report.state === 'converging-margin')) return 'converging-margin';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'safe-margin')
    ? 'safe-margin' : 'insufficient-data';
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
  if (state === 'invalid-margin-evidence') return Object.freeze(['review-memory-sensor-range']);
  if (state === 'critical-margin') return Object.freeze(['protect-critical-memory-margin', 'hold-destructive-actions']);
  if (state === 'narrow-margin') return Object.freeze(['protect-memory-margin', 'observe-next-sample']);
  if (state === 'converging-margin') return Object.freeze(['observe-memory-margin-decline']);
  if (state === 'no-observation') return Object.freeze(['request-memory-margin-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-margin-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-margin-evidence') return 'sensor-review';
  if (state === 'critical-margin') return 'critical-protection';
  if (state === 'narrow-margin') return 'margin-protection';
  if (state === 'converging-margin') return 'decline-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-margin-evidence') return 500;
  if (state === 'critical-margin') return 500;
  if (state === 'narrow-margin') return 750;
  if (state === 'converging-margin') return 1000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeMemoryPressureOomMarginReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const minimums = validated.map((report) => report.minimumMargin).filter((value) => value !== null);
  return Object.freeze({
    library: MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_ID,
    libraryVersion: MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    criticalCount: validated.reduce((sum, report) => sum + report.criticalCount, 0),
    narrowCount: validated.reduce((sum, report) => sum + report.narrowCount, 0),
    meanMargin: weightedAverage(validated, (report) => report.meanMargin),
    minimumMargin: minimums.length === 0 ? null : Math.min(...minimums),
    slope: weightedAverage(validated, (report) => report.slope),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildMemoryPressureOomMarginPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('OOM-margin library clock must return a number');
  return timestamp;
}

export function buildMemoryPressureOomMarginEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('OOM-margin library trigger is required');
  }
  return Object.freeze({
    library: MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_ID,
    libraryVersion: MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createMemoryPressureOomMarginLibrary() {
  return Object.freeze({
    id: MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_ID,
    version: MEMORY_PRESSURE_OOM_MARGIN_LIBRARY_VERSION,
    merge: mergeMemoryPressureOomMarginReports,
    plan: buildMemoryPressureOomMarginPlan,
    envelope: buildMemoryPressureOomMarginEnvelope
  });
}
