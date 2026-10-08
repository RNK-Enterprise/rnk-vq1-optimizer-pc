/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated jitter-drift library. It validates, aggregates, and plans frame
 * variance reports without importing the turbo or changing display policy.
 */

export const FRAME_JITTER_DRIFT_LIBRARY_ID = 'frame-pacing.jitter-drift.library';
export const FRAME_JITTER_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'sustained-jitter-drift', 'jitter-drift-observed', 'stable-jitter',
  'no-display', 'no-observation', 'incomplete-jitter-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, lower) {
  return Number.isFinite(value) && value >= lower;
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Jitter-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Jitter-drift library report must be an object');
  if (report.turbo !== 'frame-pacing.jitter-drift') {
    throw new Error('Jitter-drift library requires a jitter-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Jitter-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Jitter-drift library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noDisplayCount', 'no-display count'], ['noObservationCount', 'no-observation count'],
    ['deltaCount', 'delta count'], ['comparisonCount', 'comparison count']
  ]) requireCount(report, field, label);
  if (!bounded(report.maximumDelta, 0) || !bounded(report.deltaThreshold, 0)) {
    throw new RangeError('Jitter-drift library thresholds and maximumDelta must be non-negative');
  }
  if (!Number.isInteger(report.changeThreshold) || report.changeThreshold < 1
    || report.changeThreshold > 64) {
    throw new RangeError('Jitter-drift library changeThreshold must be from 1 to 64');
  }
  if (!bounded(report.confidence, 0) || report.confidence > 1) {
    throw new RangeError('Jitter-drift library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Jitter-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Jitter-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-display')) return 'no-display';
  if (reports.some((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.some((report) => report.state === 'incomplete-jitter-evidence')) return 'incomplete-jitter-evidence';
  if (reports.some((report) => report.state === 'sustained-jitter-drift')) return 'sustained-jitter-drift';
  if (reports.some((report) => report.state === 'jitter-drift-observed')) return 'jitter-drift-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-jitter';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'sustained-jitter-drift') return Object.freeze(['review-frame-jitter', 'hold-unapproved-display-policy']);
  if (state === 'jitter-drift-observed') return Object.freeze(['observe-next-jitter-sample']);
  if (state === 'no-display') return Object.freeze(['keep-display-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-frame-pacing-observation']);
  if (state === 'incomplete-jitter-evidence') return Object.freeze(['request-complete-jitter-evidence']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-jitter-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'sustained-jitter-drift') return 'jitter-review';
  if (state === 'jitter-drift-observed') return 'jitter-observation';
  if (state === 'no-display') return 'no-display-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'incomplete-jitter-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-jitter-observation';
}

function intervalFor(state, environment) {
  if (state === 'sustained-jitter-drift') return 750;
  if (state === 'jitter-drift-observed') return 1000;
  if (state === 'no-display') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'incomplete-jitter-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeFrameJitterDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: FRAME_JITTER_DRIFT_LIBRARY_ID,
    libraryVersion: FRAME_JITTER_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDisplayCount: validated.reduce((sum, report) => sum + report.noDisplayCount, 0),
    noObservationCount: validated.reduce((sum, report) => sum + report.noObservationCount, 0),
    deltaCount: validated.reduce((sum, report) => sum + report.deltaCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    maximumDelta: validated.length === 0 ? 0 : Math.max(...validated.map((report) => report.maximumDelta)),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildFrameJitterDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: FRAME_JITTER_DRIFT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Jitter-drift library clock must return a number');
  return timestamp;
}

export function buildFrameJitterDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Jitter-drift library trigger is required');
  return Object.freeze({
    library: FRAME_JITTER_DRIFT_LIBRARY_ID,
    libraryVersion: FRAME_JITTER_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createFrameJitterDriftLibrary() {
  return Object.freeze({ id: FRAME_JITTER_DRIFT_LIBRARY_ID, version: FRAME_JITTER_DRIFT_LIBRARY_VERSION,
    merge: mergeFrameJitterDriftReports, plan: buildFrameJitterDriftPlan, envelope: buildFrameJitterDriftEnvelope });
}
