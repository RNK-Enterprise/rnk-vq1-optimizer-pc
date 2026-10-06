/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated headroom-volatility turbo library. It validates, aggregates, and
 * plans dispersion reports without importing the turbo or operating-system API.
 */

export const MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_ID = 'memory-pressure.headroom-volatility.library';
export const MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-headroom',
  'volatile-headroom',
  'low-headroom',
  'shrinking-headroom',
  'invalid-headroom-evidence',
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
    throw new RangeError(`Headroom-volatility library ${label} is outside its bounded range`);
  }
  return value;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Headroom-volatility library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Headroom-volatility library report must be an object');
  if (report.turbo !== 'memory-pressure.headroom-volatility') {
    throw new Error('Headroom-volatility library requires a headroom-volatility turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Headroom-volatility library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Headroom-volatility library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['lowHeadroomCount', 'low-headroom count']
  ]) requireCount(report, field, label);
  optionalBounded(report.meanHeadroom, 0, 100, 'meanHeadroom');
  optionalBounded(report.minimumHeadroom, 0, 100, 'minimumHeadroom');
  optionalBounded(report.maximumHeadroom, 0, 100, 'maximumHeadroom');
  optionalBounded(report.headroomRange, 0, 100, 'headroomRange');
  optionalBounded(report.standardDeviation, 0, 100, 'standardDeviation');
  optionalBounded(report.slope, -100, 100, 'slope');
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Headroom-volatility library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Headroom-volatility library reports must be an array');
  if (reports.length > 64) throw new RangeError('Headroom-volatility library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-headroom-evidence')) return 'invalid-headroom-evidence';
  if (reports.some((report) => report.state === 'low-headroom')) return 'low-headroom';
  if (reports.some((report) => report.state === 'volatile-headroom')) return 'volatile-headroom';
  if (reports.some((report) => report.state === 'shrinking-headroom')) return 'shrinking-headroom';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'stable-headroom')
    ? 'stable-headroom' : 'insufficient-data';
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
  if (state === 'invalid-headroom-evidence') return Object.freeze(['review-memory-sensor-range']);
  if (state === 'low-headroom') return Object.freeze(['protect-memory-headroom', 'hold-destructive-actions']);
  if (state === 'volatile-headroom') return Object.freeze(['observe-memory-headroom-stability']);
  if (state === 'shrinking-headroom') return Object.freeze(['observe-memory-headroom-decline']);
  if (state === 'no-observation') return Object.freeze(['request-memory-headroom-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-headroom-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-headroom-evidence') return 'sensor-review';
  if (state === 'low-headroom') return 'headroom-protection';
  if (state === 'volatile-headroom') return 'stability-observation';
  if (state === 'shrinking-headroom') return 'decline-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-headroom-evidence') return 500;
  if (state === 'low-headroom') return 750;
  if (state === 'volatile-headroom') return 750;
  if (state === 'shrinking-headroom') return 1000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeMemoryPressureHeadroomVolatilityReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const minimums = validated.map((report) => report.minimumHeadroom).filter((value) => value !== null);
  const maximums = validated.map((report) => report.maximumHeadroom).filter((value) => value !== null);
  const minimumHeadroom = minimums.length === 0 ? null : Math.min(...minimums);
  const maximumHeadroom = maximums.length === 0 ? null : Math.max(...maximums);
  return Object.freeze({
    library: MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_ID,
    libraryVersion: MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    lowHeadroomCount: validated.reduce((sum, report) => sum + report.lowHeadroomCount, 0),
    meanHeadroom: weightedAverage(validated, (report) => report.meanHeadroom),
    minimumHeadroom,
    maximumHeadroom,
    headroomRange: minimumHeadroom === null || maximumHeadroom === null
      ? null : maximumHeadroom - minimumHeadroom,
    standardDeviation: weightedAverage(validated, (report) => report.standardDeviation),
    slope: weightedAverage(validated, (report) => report.slope),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildMemoryPressureHeadroomVolatilityPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Headroom-volatility library clock must return a number');
  }
  return timestamp;
}

export function buildMemoryPressureHeadroomVolatilityEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Headroom-volatility library trigger is required');
  }
  return Object.freeze({
    library: MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_ID,
    libraryVersion: MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createMemoryPressureHeadroomVolatilityLibrary() {
  return Object.freeze({
    id: MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_ID,
    version: MEMORY_PRESSURE_HEADROOM_VOLATILITY_LIBRARY_VERSION,
    merge: mergeMemoryPressureHeadroomVolatilityReports,
    plan: buildMemoryPressureHeadroomVolatilityPlan,
    envelope: buildMemoryPressureHeadroomVolatilityEnvelope
  });
}
