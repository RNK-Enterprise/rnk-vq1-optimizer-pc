/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated load-governor-mismatch turbo library. It validates and aggregates
 * load/policy reports without importing the turbo or engine implementation.
 */

export const CPU_FREQUENCY_LOAD_LIBRARY_ID = 'cpu-frequency.load-governor-mismatch.library';
export const CPU_FREQUENCY_LOAD_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'aligned-window',
  'mismatch-burst',
  'performance-under-idle',
  'powersave-under-load',
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

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Load-governor-mismatch library report must be an object');
  if (report.turbo !== 'cpu-frequency.load-governor-mismatch') {
    throw new Error('Load-governor-mismatch library requires a load-governor-mismatch turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('Load-governor-mismatch library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Load-governor-mismatch library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['powersaveUnderLoadCount', 'powersave count'],
    ['performanceUnderIdleCount', 'performance count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
      throw new RangeError(`Load-governor-mismatch library report ${label} must fit inside sampleCount`);
    }
  }
  if (!bounded(report.mismatchRate, 0, 1)) {
    throw new RangeError('Load-governor-mismatch library report mismatchRate must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Load-governor-mismatch library reports must be an array');
  if (reports.length > 64) throw new RangeError('Load-governor-mismatch library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function weightedAverage(reports, selector) {
  if (reports.length === 0) return null;
  const totalWeight = reports.reduce((sum, report) => sum + Math.max(1, report.sampleCount), 0);
  const total = reports.reduce((sum, report) => (
    sum + selector(report) * Math.max(1, report.sampleCount)
  ), 0);
  return Math.round((total / totalWeight) * 10000) / 10000;
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'powersave-under-load')) return 'powersave-under-load';
  if (reports.some((report) => report.state === 'performance-under-idle')) return 'performance-under-idle';
  if (reports.some((report) => report.state === 'mismatch-burst')) return 'mismatch-burst';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  return reports.some((report) => report.state === 'aligned-window')
    ? 'aligned-window'
    : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'powersave-under-load') return Object.freeze(['review-documented-frequency-control']);
  if (state === 'performance-under-idle') return Object.freeze(['review-idle-frequency-control']);
  if (state === 'mismatch-burst') return Object.freeze(['observe-load-governor-alignment']);
  if (state === 'no-observation') return Object.freeze(['request-load-governor-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-frequency-samples']);
  return Object.freeze(['no-change']);
}

export function mergeCpuFrequencyLoadReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_FREQUENCY_LOAD_LIBRARY_ID,
    libraryVersion: CPU_FREQUENCY_LOAD_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    powersaveUnderLoadCount: validated.reduce(
      (sum, report) => sum + report.powersaveUnderLoadCount, 0
    ),
    performanceUnderIdleCount: validated.reduce(
      (sum, report) => sum + report.performanceUnderIdleCount, 0
    ),
    mismatchRate: weightedAverage(validated, (report) => report.mismatchRate),
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'powersave-under-load') return 'throughput-policy-review';
  if (state === 'performance-under-idle') return 'idle-policy-review';
  if (state === 'mismatch-burst') return 'alignment-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'powersave-under-load' || state === 'performance-under-idle') return 500;
  if (state === 'mismatch-burst') return 750;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function buildCpuFrequencyLoadPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_FREQUENCY_LOAD_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.observedCount === 0 || validated.sampleCount === 0
      ? 0
      : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Load-governor-mismatch library clock must return a number');
  return timestamp;
}

export function buildCpuFrequencyLoadEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Load-governor-mismatch library trigger is required');
  }
  return Object.freeze({
    library: CPU_FREQUENCY_LOAD_LIBRARY_ID,
    libraryVersion: CPU_FREQUENCY_LOAD_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuFrequencyLoadLibrary() {
  return Object.freeze({
    id: CPU_FREQUENCY_LOAD_LIBRARY_ID,
    version: CPU_FREQUENCY_LOAD_LIBRARY_VERSION,
    merge: mergeCpuFrequencyLoadReports,
    plan: buildCpuFrequencyLoadPlan,
    envelope: buildCpuFrequencyLoadEnvelope
  });
}
