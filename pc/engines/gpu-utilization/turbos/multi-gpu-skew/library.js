/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated multi-gpu-skew library. It validates, aggregates, and plans
 * adapter-balance reports without importing the turbo or changing GPU policy.
 */

export const GPU_MULTI_GPU_SKEW_LIBRARY_ID = 'gpu-utilization.multi-gpu-skew.library';
export const GPU_MULTI_GPU_SKEW_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'sustained-skew',
  'skew-observed',
  'balanced-gpu-layout',
  'no-gpu',
  'invalid-skew-evidence',
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
    throw new RangeError(`Multi-gpu-skew library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Multi-gpu-skew library report must be an object');
  if (report.turbo !== 'gpu-utilization.multi-gpu-skew') {
    throw new Error('Multi-gpu-skew library requires a multi-gpu-skew turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Multi-gpu-skew library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Multi-gpu-skew library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['noGpuCount', 'no-GPU count'],
    ['skewCount', 'skew count'],
    ['balancedCount', 'balanced count']
  ]) requireCount(report, field, label);
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Multi-gpu-skew library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Multi-gpu-skew library reports must be an array');
  if (reports.length > 64) throw new RangeError('Multi-gpu-skew library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-skew-evidence')) return 'invalid-skew-evidence';
  if (reports.some((report) => report.state === 'sustained-skew')) return 'sustained-skew';
  if (reports.some((report) => report.state === 'skew-observed')) return 'skew-observed';
  if (reports.every((report) => report.state === 'no-gpu')) return 'no-gpu';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'balanced-gpu-layout')
    ? 'balanced-gpu-layout' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'invalid-skew-evidence') return Object.freeze(['review-gpu-utilization-sensor-range']);
  if (state === 'sustained-skew') return Object.freeze(['review-gpu-workload-distribution', 'hold-unapproved-gpu-policy']);
  if (state === 'skew-observed') return Object.freeze(['observe-next-gpu-layout-sample']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-gpu-skew-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-gpu-skew-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-skew-evidence') return 'sensor-review';
  if (state === 'sustained-skew') return 'workload-distribution-review';
  if (state === 'skew-observed') return 'skew-observation';
  if (state === 'no-gpu') return 'no-gpu-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'balanced-layout-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-skew-evidence') return 500;
  if (state === 'sustained-skew') return 750;
  if (state === 'skew-observed') return 1000;
  if (state === 'no-gpu') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeGpuMultiGpuSkewReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: GPU_MULTI_GPU_SKEW_LIBRARY_ID,
    libraryVersion: GPU_MULTI_GPU_SKEW_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    noGpuCount: validated.reduce((sum, report) => sum + report.noGpuCount, 0),
    skewCount: validated.reduce((sum, report) => sum + report.skewCount, 0),
    balancedCount: validated.reduce((sum, report) => sum + report.balancedCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildGpuMultiGpuSkewPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: GPU_MULTI_GPU_SKEW_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Multi-gpu-skew library clock must return a number');
  return timestamp;
}

export function buildGpuMultiGpuSkewEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Multi-gpu-skew library trigger is required');
  }
  return Object.freeze({
    library: GPU_MULTI_GPU_SKEW_LIBRARY_ID,
    libraryVersion: GPU_MULTI_GPU_SKEW_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createGpuMultiGpuSkewLibrary() {
  return Object.freeze({
    id: GPU_MULTI_GPU_SKEW_LIBRARY_ID,
    version: GPU_MULTI_GPU_SKEW_LIBRARY_VERSION,
    merge: mergeGpuMultiGpuSkewReports,
    plan: buildGpuMultiGpuSkewPlan,
    envelope: buildGpuMultiGpuSkewEnvelope
  });
}
