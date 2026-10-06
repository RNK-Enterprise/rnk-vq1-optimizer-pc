/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated occupancy-drift library. It validates, aggregates, and plans VRAM
 * movement reports without importing the turbo or changing memory policy.
 */

export const GPU_OCCUPANCY_DRIFT_LIBRARY_ID = 'gpu-memory.occupancy-drift.library';
export const GPU_OCCUPANCY_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'sustained-occupancy-drift',
  'occupancy-drift-observed',
  'stable-occupancy',
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
    throw new RangeError(`Occupancy-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Occupancy-drift library report must be an object');
  if (report.turbo !== 'gpu-memory.occupancy-drift') {
    throw new Error('Occupancy-drift library requires an occupancy-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Occupancy-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Occupancy-drift library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['invalidCount', 'invalid count'],
    ['incompleteCount', 'incomplete count'],
    ['noGpuCount', 'no-GPU count'],
    ['deltaCount', 'delta count'],
    ['comparisonCount', 'comparison count']
  ]) requireCount(report, field, label);
  if (!bounded(report.maximumDelta, 0, 100)) {
    throw new RangeError('Occupancy-drift library maximumDelta must be between 0 and 100');
  }
  if (!bounded(report.deltaThreshold, 0, 100)) {
    throw new RangeError('Occupancy-drift library deltaThreshold must be between 0 and 100');
  }
  if (!Number.isInteger(report.changeThreshold) || report.changeThreshold < 1
    || report.changeThreshold > 64) {
    throw new RangeError('Occupancy-drift library changeThreshold must be from 1 to 64');
  }
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Occupancy-drift library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Occupancy-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Occupancy-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-vram-evidence')) return 'invalid-vram-evidence';
  if (reports.some((report) => report.state === 'incomplete-vram-evidence')) {
    return 'incomplete-vram-evidence';
  }
  if (reports.some((report) => report.state === 'sustained-occupancy-drift')) {
    return 'sustained-occupancy-drift';
  }
  if (reports.some((report) => report.state === 'occupancy-drift-observed')) {
    return 'occupancy-drift-observed';
  }
  if (reports.every((report) => report.state === 'no-gpu')) return 'no-gpu';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'stable-occupancy')
    ? 'stable-occupancy' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'sustained-occupancy-drift') {
    return Object.freeze(['review-vram-workload-pattern', 'hold-unapproved-memory-policy']);
  }
  if (state === 'occupancy-drift-observed') return Object.freeze(['observe-next-vram-sample']);
  if (state === 'invalid-vram-evidence') return Object.freeze(['review-vram-counter-range']);
  if (state === 'incomplete-vram-evidence') return Object.freeze(['request-complete-vram-evidence']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-memory-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-vram-occupancy-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-vram-occupancy-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'sustained-occupancy-drift') return 'occupancy-workload-review';
  if (state === 'occupancy-drift-observed') return 'occupancy-observation';
  if (state === 'invalid-vram-evidence') return 'counter-review';
  if (state === 'incomplete-vram-evidence') return 'evidence-bootstrap';
  if (state === 'no-gpu') return 'no-gpu-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-occupancy-observation';
}

function intervalFor(state, environment) {
  if (state === 'sustained-occupancy-drift') return 750;
  if (state === 'occupancy-drift-observed') return 1000;
  if (state === 'invalid-vram-evidence') return 500;
  if (state === 'incomplete-vram-evidence') return 1500;
  if (state === 'no-gpu') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeGpuOccupancyDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: GPU_OCCUPANCY_DRIFT_LIBRARY_ID,
    libraryVersion: GPU_OCCUPANCY_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noGpuCount: validated.reduce((sum, report) => sum + report.noGpuCount, 0),
    deltaCount: validated.reduce((sum, report) => sum + report.deltaCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    maximumDelta: validated.length === 0 ? 0
      : Math.max(...validated.map((report) => report.maximumDelta)),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildGpuOccupancyDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: GPU_OCCUPANCY_DRIFT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Occupancy-drift library clock must return a number');
  return timestamp;
}

export function buildGpuOccupancyDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Occupancy-drift library trigger is required');
  }
  return Object.freeze({
    library: GPU_OCCUPANCY_DRIFT_LIBRARY_ID,
    libraryVersion: GPU_OCCUPANCY_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createGpuOccupancyDriftLibrary() {
  return Object.freeze({
    id: GPU_OCCUPANCY_DRIFT_LIBRARY_ID,
    version: GPU_OCCUPANCY_DRIFT_LIBRARY_VERSION,
    merge: mergeGpuOccupancyDriftReports,
    plan: buildGpuOccupancyDriftPlan,
    envelope: buildGpuOccupancyDriftEnvelope
  });
}
