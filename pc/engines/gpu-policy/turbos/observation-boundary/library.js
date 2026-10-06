/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated observation-boundary library. It validates, aggregates, and plans
 * capability reports without importing the turbo or enabling GPU observation.
 */

export const GPU_OBSERVATION_BOUNDARY_LIBRARY_ID = 'gpu-policy.observation-boundary.library';
export const GPU_OBSERVATION_BOUNDARY_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'sustained-observation-boundary-drift',
  'observation-boundary-observed',
  'observation-enabled-stable',
  'observation-disabled-persistent',
  'observation-unknown',
  'observation-boundary-drift',
  'no-gpu',
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
    throw new RangeError(`Observation-boundary library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Observation-boundary library report must be an object');
  if (report.turbo !== 'gpu-policy.observation-boundary') {
    throw new Error('Observation-boundary library requires an observation-boundary turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('Observation-boundary library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Observation-boundary library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['enabledCount', 'enabled count'],
    ['disabledCount', 'disabled count'],
    ['unknownCount', 'unknown count'],
    ['noGpuCount', 'no-GPU count'],
    ['transitionCount', 'transition count']
  ]) requireCount(report, field, label);
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Observation-boundary library persistenceThreshold must be from 1 to 64');
  }
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Observation-boundary library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Observation-boundary library reports must be an array');
  if (reports.length > 64) throw new RangeError('Observation-boundary library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'observation-unknown')) return 'observation-unknown';
  if (reports.some((report) => report.state === 'observation-boundary-drift')) {
    return 'observation-boundary-drift';
  }
  if (reports.some((report) => report.state === 'sustained-observation-boundary-drift')) {
    return 'sustained-observation-boundary-drift';
  }
  if (reports.some((report) => report.state === 'observation-boundary-observed')) {
    return 'observation-boundary-observed';
  }
  if (reports.every((report) => report.state === 'no-gpu')) return 'no-gpu';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  if (reports.some((report) => report.state === 'observation-disabled-persistent')) {
    return 'observation-disabled-persistent';
  }
  return reports.some((report) => report.state === 'observation-enabled-stable')
    ? 'observation-enabled-stable' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'sustained-observation-boundary-drift') {
    return Object.freeze(['review-gpu-observation-stability', 'hold-unapproved-gpu-policy']);
  }
  if (state === 'observation-boundary-observed') {
    return Object.freeze(['observe-next-gpu-observation-sample']);
  }
  if (state === 'observation-enabled-stable') return Object.freeze(['no-change']);
  if (state === 'observation-disabled-persistent') {
    return Object.freeze(['keep-gpu-observation-disabled']);
  }
  if (state === 'observation-unknown') {
    return Object.freeze(['request-gpu-observation-capability-evidence']);
  }
  if (state === 'observation-boundary-drift') {
    return Object.freeze(['review-gpu-observation-boundary', 'hold-unapproved-gpu-policy']);
  }
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-controls-disabled']);
  return Object.freeze(['collect-more-gpu-observation-samples']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'sustained-observation-boundary-drift') return 'observation-stability-review';
  if (state === 'observation-boundary-observed') return 'observation-boundary-review';
  if (state === 'observation-enabled-stable') return 'enabled-observation';
  if (state === 'observation-disabled-persistent') return 'disabled-observation';
  if (state === 'observation-unknown') return 'capability-bootstrap';
  if (state === 'observation-boundary-drift') return 'inventory-boundary-review';
  if (state === 'no-gpu') return 'no-gpu-observation';
  return 'sample-bootstrap';
}

function intervalFor(state, environment) {
  if (state === 'sustained-observation-boundary-drift') return 750;
  if (state === 'observation-boundary-observed') return 1000;
  if (state === 'observation-enabled-stable') return environment === 'headless' ? 10000 : 5000;
  if (state === 'observation-disabled-persistent') return 10000;
  if (state === 'observation-unknown') return 1500;
  if (state === 'observation-boundary-drift') return 1250;
  if (state === 'no-gpu') return 10000;
  return 1500;
}

export function mergeGpuObservationBoundaryReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: GPU_OBSERVATION_BOUNDARY_LIBRARY_ID,
    libraryVersion: GPU_OBSERVATION_BOUNDARY_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    enabledCount: validated.reduce((sum, report) => sum + report.enabledCount, 0),
    disabledCount: validated.reduce((sum, report) => sum + report.disabledCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    noGpuCount: validated.reduce((sum, report) => sum + report.noGpuCount, 0),
    transitionCount: validated.reduce((sum, report) => sum + report.transitionCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildGpuObservationBoundaryPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: GPU_OBSERVATION_BOUNDARY_LIBRARY_ID,
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
    throw new TypeError('Observation-boundary library clock must return a number');
  }
  return timestamp;
}

export function buildGpuObservationBoundaryEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Observation-boundary library trigger is required');
  }
  return Object.freeze({
    library: GPU_OBSERVATION_BOUNDARY_LIBRARY_ID,
    libraryVersion: GPU_OBSERVATION_BOUNDARY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createGpuObservationBoundaryLibrary() {
  return Object.freeze({
    id: GPU_OBSERVATION_BOUNDARY_LIBRARY_ID,
    version: GPU_OBSERVATION_BOUNDARY_LIBRARY_VERSION,
    merge: mergeGpuObservationBoundaryReports,
    plan: buildGpuObservationBoundaryPlan,
    envelope: buildGpuObservationBoundaryEnvelope
  });
}
