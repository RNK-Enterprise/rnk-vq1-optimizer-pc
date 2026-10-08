/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated capacity-skew library. It validates, aggregates, and plans VRAM
 * capacity composition reports without importing the turbo or changing policy.
 */

export const GPU_CAPACITY_SKEW_LIBRARY_ID = 'gpu-memory.capacity-skew.library';
export const GPU_CAPACITY_SKEW_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'sustained-capacity-skew',
  'capacity-skew-observed',
  'balanced-capacity',
  'invalid-vram-evidence',
  'incomplete-vram-evidence',
  'no-gpu',
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
    throw new RangeError(`Capacity-skew library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Capacity-skew library report must be an object');
  if (report.turbo !== 'gpu-memory.capacity-skew') {
    throw new Error('Capacity-skew library requires a capacity-skew turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Capacity-skew library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Capacity-skew library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['invalidCount', 'invalid count'],
    ['incompleteCount', 'incomplete count'],
    ['noGpuCount', 'no-GPU count'],
    ['skewCount', 'skew count'],
    ['balancedCount', 'balanced count']
  ]) requireCount(report, field, label);
  if (!bounded(report.maximumSkew, 0, 100)) {
    throw new RangeError('Capacity-skew library maximumSkew must be between 0 and 100');
  }
  if (!bounded(report.skewThreshold, 0, 100)) {
    throw new RangeError('Capacity-skew library skewThreshold must be between 0 and 100');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Capacity-skew library persistenceThreshold must be from 1 to 64');
  }
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Capacity-skew library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Capacity-skew library reports must be an array');
  if (reports.length > 64) throw new RangeError('Capacity-skew library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-vram-evidence')) return 'invalid-vram-evidence';
  if (reports.some((report) => report.state === 'incomplete-vram-evidence')) {
    return 'incomplete-vram-evidence';
  }
  if (reports.some((report) => report.state === 'sustained-capacity-skew')) {
    return 'sustained-capacity-skew';
  }
  if (reports.some((report) => report.state === 'capacity-skew-observed')) {
    return 'capacity-skew-observed';
  }
  if (reports.every((report) => report.state === 'no-gpu')) return 'no-gpu';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'balanced-capacity')
    ? 'balanced-capacity' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'sustained-capacity-skew') {
    return Object.freeze(['review-multi-gpu-capacity-layout', 'hold-unapproved-memory-policy']);
  }
  if (state === 'capacity-skew-observed') return Object.freeze(['observe-next-vram-capacity-sample']);
  if (state === 'invalid-vram-evidence') return Object.freeze(['review-vram-capacity-range']);
  if (state === 'incomplete-vram-evidence') return Object.freeze(['request-complete-vram-capacity']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-memory-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-vram-capacity-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-vram-capacity-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'sustained-capacity-skew') return 'capacity-layout-review';
  if (state === 'capacity-skew-observed') return 'capacity-skew-observation';
  if (state === 'invalid-vram-evidence') return 'capacity-review';
  if (state === 'incomplete-vram-evidence') return 'evidence-bootstrap';
  if (state === 'no-gpu') return 'no-gpu-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'balanced-capacity-observation';
}

function intervalFor(state, environment) {
  if (state === 'sustained-capacity-skew') return 750;
  if (state === 'capacity-skew-observed') return 1000;
  if (state === 'invalid-vram-evidence') return 500;
  if (state === 'incomplete-vram-evidence') return 1500;
  if (state === 'no-gpu') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeGpuCapacitySkewReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: GPU_CAPACITY_SKEW_LIBRARY_ID,
    libraryVersion: GPU_CAPACITY_SKEW_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noGpuCount: validated.reduce((sum, report) => sum + report.noGpuCount, 0),
    skewCount: validated.reduce((sum, report) => sum + report.skewCount, 0),
    balancedCount: validated.reduce((sum, report) => sum + report.balancedCount, 0),
    maximumSkew: validated.length === 0 ? 0 : Math.max(...validated.map((report) => report.maximumSkew)),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildGpuCapacitySkewPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: GPU_CAPACITY_SKEW_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Capacity-skew library clock must return a number');
  return timestamp;
}

export function buildGpuCapacitySkewEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Capacity-skew library trigger is required');
  }
  return Object.freeze({
    library: GPU_CAPACITY_SKEW_LIBRARY_ID,
    libraryVersion: GPU_CAPACITY_SKEW_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createGpuCapacitySkewLibrary() {
  return Object.freeze({
    id: GPU_CAPACITY_SKEW_LIBRARY_ID,
    version: GPU_CAPACITY_SKEW_LIBRARY_VERSION,
    merge: mergeGpuCapacitySkewReports,
    plan: buildGpuCapacitySkewPlan,
    envelope: buildGpuCapacitySkewEnvelope
  });
}
