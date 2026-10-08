/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated cadence-stability library. It validates, aggregates, and plans
 * frame-time movement reports without importing the turbo or changing policy.
 */

export const FRAME_CADENCE_STABILITY_LIBRARY_ID = 'frame-pacing.cadence-stability.library';
export const FRAME_CADENCE_STABILITY_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'sustained-cadence-drift', 'cadence-drift-observed', 'stable-cadence',
  'no-display', 'no-observation', 'incomplete-cadence-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Cadence-stability library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Cadence-stability library report must be an object');
  if (report.turbo !== 'frame-pacing.cadence-stability') {
    throw new Error('Cadence-stability library requires a cadence-stability turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('Cadence-stability library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Cadence-stability library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Cadence-stability library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Cadence-stability library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noDisplayCount', 'no-display count'], ['noObservationCount', 'no-observation count'],
    ['driftCount', 'drift count'], ['comparisonCount', 'comparison count']
  ]) requireCount(report, field, label);
  if (!nonNegative(report.maximumDelta) || !nonNegative(report.deltaThreshold)) {
    throw new RangeError('Cadence-stability library thresholds and maximumDelta must be non-negative');
  }
  if (!nonNegative(report.confidence) || report.confidence > 1) {
    throw new RangeError('Cadence-stability library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Cadence-stability library reports must be an array');
  if (reports.length > 64) throw new RangeError('Cadence-stability library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-display')) return 'no-display';
  if (reports.some((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.some((report) => report.state === 'incomplete-cadence-evidence')) {
    return 'incomplete-cadence-evidence';
  }
  if (reports.some((report) => report.state === 'sustained-cadence-drift')) {
    return 'sustained-cadence-drift';
  }
  if (reports.some((report) => report.state === 'cadence-drift-observed')) {
    return 'cadence-drift-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-cadence';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cadence-samples']);
  if (state === 'no-display') return Object.freeze(['keep-display-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-cadence-observation']);
  if (state === 'incomplete-cadence-evidence') {
    return Object.freeze(['request-complete-cadence-evidence']);
  }
  if (state === 'sustained-cadence-drift') {
    return Object.freeze(['review-frame-cadence', 'hold-unapproved-display-policy']);
  }
  if (state === 'cadence-drift-observed') return Object.freeze(['observe-next-cadence-sample']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'sustained-cadence-drift') return 'cadence-review';
  if (state === 'cadence-drift-observed') return 'cadence-observation';
  if (state === 'no-display') return 'no-display-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'incomplete-cadence-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-cadence-observation';
}

function intervalFor(state, environment) {
  if (state === 'sustained-cadence-drift') return 750;
  if (state === 'cadence-drift-observed') return 1000;
  if (state === 'no-display') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'incomplete-cadence-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeFrameCadenceStabilityReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: FRAME_CADENCE_STABILITY_LIBRARY_ID,
    libraryVersion: FRAME_CADENCE_STABILITY_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDisplayCount: validated.reduce((sum, report) => sum + report.noDisplayCount, 0),
    noObservationCount: validated.reduce((sum, report) => sum + report.noObservationCount, 0),
    driftCount: validated.reduce((sum, report) => sum + report.driftCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    maximumDelta: validated.length === 0 ? 0
      : Math.max(...validated.map((report) => report.maximumDelta)),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildFrameCadenceStabilityPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: FRAME_CADENCE_STABILITY_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0 ? 0
      : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Cadence-stability library clock must return a number');
  }
  return timestamp;
}

export function buildFrameCadenceStabilityEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Cadence-stability library trigger is required');
  }
  return Object.freeze({
    library: FRAME_CADENCE_STABILITY_LIBRARY_ID,
    libraryVersion: FRAME_CADENCE_STABILITY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createFrameCadenceStabilityLibrary() {
  return Object.freeze({
    id: FRAME_CADENCE_STABILITY_LIBRARY_ID,
    version: FRAME_CADENCE_STABILITY_LIBRARY_VERSION,
    merge: mergeFrameCadenceStabilityReports,
    plan: buildFrameCadenceStabilityPlan,
    envelope: buildFrameCadenceStabilityEnvelope
  });
}
