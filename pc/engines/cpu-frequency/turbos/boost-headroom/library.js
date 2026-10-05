/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated boost-headroom turbo library. It validates, aggregates, and plans
 * headroom reports without importing the turbo or operating-system API.
 */

export const CPU_FREQUENCY_HEADROOM_LIBRARY_ID = 'cpu-frequency.boost-headroom.library';
export const CPU_FREQUENCY_HEADROOM_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'request-satisfied',
  'variable-headroom',
  'boost-shortfall-under-load',
  'thermal-limited',
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

function optionalHeadroom(value) {
  if (value === null) return null;
  if (!bounded(value, 0, 1)) throw new RangeError('Headroom library averageHeadroom must be between 0 and 1');
  return value;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Headroom library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Headroom library report must be an object');
  if (report.turbo !== 'cpu-frequency.boost-headroom') {
    throw new Error('Headroom library requires a boost-headroom turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Headroom library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Headroom library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['thermalCount', 'thermal count'],
    ['thermalShortfallCount', 'thermal shortfall count'],
    ['shortfallUnderLoadCount', 'shortfall-under-load count'],
    ['satisfiedCount', 'satisfied count'],
    ['shortfallCount', 'shortfall count']
  ]) requireCount(report, field, label);
  optionalHeadroom(report.averageHeadroom);
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Headroom library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Headroom library reports must be an array');
  if (reports.length > 64) throw new RangeError('Headroom library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-frequency-evidence')) {
    return 'invalid-frequency-evidence';
  }
  if (reports.some((report) => report.state === 'thermal-limited')) return 'thermal-limited';
  if (reports.some((report) => report.state === 'boost-shortfall-under-load')) {
    return 'boost-shortfall-under-load';
  }
  if (reports.some((report) => report.state === 'variable-headroom')) return 'variable-headroom';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'request-satisfied')
    ? 'request-satisfied' : 'insufficient-data';
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
  if (state === 'thermal-limited') return Object.freeze(['review-thermal-limits-before-frequency-control']);
  if (state === 'boost-shortfall-under-load') return Object.freeze(['review-documented-boost-control']);
  if (state === 'variable-headroom') return Object.freeze(['observe-requested-frequency-stability']);
  if (state === 'no-observation') return Object.freeze(['request-boost-headroom-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-frequency-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-frequency-evidence') return 'sensor-review';
  if (state === 'thermal-limited') return 'thermal-review';
  if (state === 'boost-shortfall-under-load') return 'boost-review';
  if (state === 'variable-headroom') return 'headroom-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-frequency-evidence') return 500;
  if (state === 'thermal-limited') return 750;
  if (state === 'boost-shortfall-under-load') return 1000;
  if (state === 'variable-headroom') return 1000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeCpuFrequencyHeadroomReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_FREQUENCY_HEADROOM_LIBRARY_ID,
    libraryVersion: CPU_FREQUENCY_HEADROOM_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    thermalCount: validated.reduce((sum, report) => sum + report.thermalCount, 0),
    thermalShortfallCount: validated.reduce((sum, report) => sum + report.thermalShortfallCount, 0),
    shortfallUnderLoadCount: validated.reduce((sum, report) => sum + report.shortfallUnderLoadCount, 0),
    satisfiedCount: validated.reduce((sum, report) => sum + report.satisfiedCount, 0),
    shortfallCount: validated.reduce((sum, report) => sum + report.shortfallCount, 0),
    averageHeadroom: weightedAverage(validated, (report) => report.averageHeadroom),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildCpuFrequencyHeadroomPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_FREQUENCY_HEADROOM_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Headroom library clock must return a number');
  return timestamp;
}

export function buildCpuFrequencyHeadroomEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Headroom library trigger is required');
  }
  return Object.freeze({
    library: CPU_FREQUENCY_HEADROOM_LIBRARY_ID,
    libraryVersion: CPU_FREQUENCY_HEADROOM_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuFrequencyHeadroomLibrary() {
  return Object.freeze({
    id: CPU_FREQUENCY_HEADROOM_LIBRARY_ID,
    version: CPU_FREQUENCY_HEADROOM_LIBRARY_VERSION,
    merge: mergeCpuFrequencyHeadroomReports,
    plan: buildCpuFrequencyHeadroomPlan,
    envelope: buildCpuFrequencyHeadroomEnvelope
  });
}
