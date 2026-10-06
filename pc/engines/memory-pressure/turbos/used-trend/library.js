/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated used-trend turbo library. It validates, aggregates, and plans
 * trend reports without importing the turbo or operating-system API.
 */

export const MEMORY_PRESSURE_USED_TREND_LIBRARY_ID = 'memory-pressure.used-trend.library';
export const MEMORY_PRESSURE_USED_TREND_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-pressure',
  'rising-pressure',
  'falling-pressure',
  'volatile-pressure',
  'high-pressure',
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

function optionalBounded(value, lower, upper, label) {
  if (value === null) return null;
  if (!bounded(value, lower, upper)) {
    throw new RangeError(`Used-trend library ${label} is outside its bounded range`);
  }
  return value;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Used-trend library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Used-trend library report must be an object');
  if (report.turbo !== 'memory-pressure.used-trend') {
    throw new Error('Used-trend library requires a used-trend turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Used-trend library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Used-trend library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['highPressureCount', 'high-pressure count'],
    ['growthCount', 'growth count'],
    ['declineCount', 'decline count'],
    ['comparisonCount', 'comparison count'],
    ['reversalCount', 'reversal count']
  ]) requireCount(report, field, label);
  optionalBounded(report.averageAbsoluteDelta, 0, 100, 'averageAbsoluteDelta');
  optionalBounded(report.slope, -100, 100, 'slope');
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Used-trend library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Used-trend library reports must be an array');
  if (reports.length > 64) throw new RangeError('Used-trend library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-pressure-evidence')) return 'invalid-pressure-evidence';
  if (reports.some((report) => report.state === 'high-pressure')) return 'high-pressure';
  if (reports.some((report) => report.state === 'rising-pressure')) return 'rising-pressure';
  if (reports.some((report) => report.state === 'falling-pressure')) return 'falling-pressure';
  if (reports.some((report) => report.state === 'volatile-pressure')) return 'volatile-pressure';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'stable-pressure')
    ? 'stable-pressure' : 'insufficient-data';
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
  if (state === 'invalid-pressure-evidence') return Object.freeze(['review-memory-sensor-range']);
  if (state === 'high-pressure') return Object.freeze(['protect-memory-headroom', 'hold-destructive-actions']);
  if (state === 'rising-pressure') return Object.freeze(['observe-memory-growth']);
  if (state === 'falling-pressure') return Object.freeze(['observe-memory-recovery']);
  if (state === 'volatile-pressure') return Object.freeze(['observe-memory-pressure-stability']);
  if (state === 'no-observation') return Object.freeze(['request-memory-pressure-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-memory-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-pressure-evidence') return 'sensor-review';
  if (state === 'high-pressure') return 'headroom-protection';
  if (state === 'rising-pressure') return 'growth-observation';
  if (state === 'falling-pressure') return 'recovery-observation';
  if (state === 'volatile-pressure') return 'stability-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-pressure-evidence') return 500;
  if (state === 'high-pressure') return 750;
  if (state === 'rising-pressure') return 1000;
  if (state === 'falling-pressure') return 1500;
  if (state === 'volatile-pressure') return 750;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeMemoryPressureUsedTrendReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: MEMORY_PRESSURE_USED_TREND_LIBRARY_ID,
    libraryVersion: MEMORY_PRESSURE_USED_TREND_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    highPressureCount: validated.reduce((sum, report) => sum + report.highPressureCount, 0),
    growthCount: validated.reduce((sum, report) => sum + report.growthCount, 0),
    declineCount: validated.reduce((sum, report) => sum + report.declineCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    reversalCount: validated.reduce((sum, report) => sum + report.reversalCount, 0),
    averageAbsoluteDelta: weightedAverage(validated, (report) => report.averageAbsoluteDelta),
    slope: weightedAverage(validated, (report) => report.slope),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildMemoryPressureUsedTrendPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: MEMORY_PRESSURE_USED_TREND_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Used-trend library clock must return a number');
  return timestamp;
}

export function buildMemoryPressureUsedTrendEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Used-trend library trigger is required');
  }
  return Object.freeze({
    library: MEMORY_PRESSURE_USED_TREND_LIBRARY_ID,
    libraryVersion: MEMORY_PRESSURE_USED_TREND_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createMemoryPressureUsedTrendLibrary() {
  return Object.freeze({
    id: MEMORY_PRESSURE_USED_TREND_LIBRARY_ID,
    version: MEMORY_PRESSURE_USED_TREND_LIBRARY_VERSION,
    merge: mergeMemoryPressureUsedTrendReports,
    plan: buildMemoryPressureUsedTrendPlan,
    envelope: buildMemoryPressureUsedTrendEnvelope
  });
}
