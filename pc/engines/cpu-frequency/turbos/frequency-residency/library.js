/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated frequency-residency turbo library. It validates, aggregates, and
 * plans residency reports without importing the turbo or operating-system API.
 */

export const CPU_FREQUENCY_RESIDENCY_LIBRARY_ID = 'cpu-frequency.frequency-residency.library';
export const CPU_FREQUENCY_RESIDENCY_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'balanced-residency',
  'low-residency-under-load',
  'sustained-boost-residency',
  'unstable-residency',
  'invalid-frequency-evidence',
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

function optionalRatio(value, label) {
  if (value === null) return null;
  if (!bounded(value, 0, 2)) throw new RangeError(`Residency library ${label} must be between 0 and 2`);
  return value;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Residency library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Residency library report must be an object');
  if (report.turbo !== 'cpu-frequency.frequency-residency') {
    throw new Error('Residency library requires a frequency-residency turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Residency library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Residency library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['lowUnderLoadCount', 'low-under-load count'],
    ['boostCount', 'boost count'],
    ['comparisonCount', 'comparison count'],
    ['transitionCount', 'transition count']
  ]) requireCount(report, field, label);
  optionalRatio(report.averageRatio, 'averageRatio');
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Residency library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Residency library reports must be an array');
  if (reports.length > 64) throw new RangeError('Residency library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-frequency-evidence')) {
    return 'invalid-frequency-evidence';
  }
  if (reports.some((report) => report.state === 'low-residency-under-load')) {
    return 'low-residency-under-load';
  }
  if (reports.some((report) => report.state === 'sustained-boost-residency')) {
    return 'sustained-boost-residency';
  }
  if (reports.some((report) => report.state === 'unstable-residency')) return 'unstable-residency';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'balanced-residency')
    ? 'balanced-residency' : 'insufficient-data';
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
  if (state === 'invalid-frequency-evidence') return Object.freeze(['review-frequency-sensor-range']);
  if (state === 'low-residency-under-load') return Object.freeze(['review-documented-frequency-control']);
  if (state === 'sustained-boost-residency') return Object.freeze(['observe-boost-duration-and-thermal-state']);
  if (state === 'unstable-residency') return Object.freeze(['observe-frequency-residency-stability']);
  if (state === 'no-observation') return Object.freeze(['request-frequency-residency-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-frequency-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-frequency-evidence') return 'sensor-review';
  if (state === 'low-residency-under-load') return 'load-review';
  if (state === 'sustained-boost-residency') return 'boost-observation';
  if (state === 'unstable-residency') return 'stability-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-frequency-evidence') return 500;
  if (state === 'low-residency-under-load') return 1000;
  if (state === 'sustained-boost-residency') return 1500;
  if (state === 'unstable-residency') return 750;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeCpuFrequencyResidencyReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_FREQUENCY_RESIDENCY_LIBRARY_ID,
    libraryVersion: CPU_FREQUENCY_RESIDENCY_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    lowUnderLoadCount: validated.reduce((sum, report) => sum + report.lowUnderLoadCount, 0),
    boostCount: validated.reduce((sum, report) => sum + report.boostCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    transitionCount: validated.reduce((sum, report) => sum + report.transitionCount, 0),
    averageRatio: weightedAverage(validated, (report) => report.averageRatio),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildCpuFrequencyResidencyPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_FREQUENCY_RESIDENCY_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0
      ? 0
      : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Residency library clock must return a number');
  return timestamp;
}

export function buildCpuFrequencyResidencyEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Residency library trigger is required');
  }
  return Object.freeze({
    library: CPU_FREQUENCY_RESIDENCY_LIBRARY_ID,
    libraryVersion: CPU_FREQUENCY_RESIDENCY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuFrequencyResidencyLibrary() {
  return Object.freeze({
    id: CPU_FREQUENCY_RESIDENCY_LIBRARY_ID,
    version: CPU_FREQUENCY_RESIDENCY_LIBRARY_VERSION,
    merge: mergeCpuFrequencyResidencyReports,
    plan: buildCpuFrequencyResidencyPlan,
    envelope: buildCpuFrequencyResidencyEnvelope
  });
}
