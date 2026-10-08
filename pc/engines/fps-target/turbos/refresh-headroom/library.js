/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated refresh-headroom library. It validates, aggregates, and plans
 * headroom reports without importing the turbo or changing FPS policy.
 */

export const FPS_REFRESH_HEADROOM_LIBRARY_ID = 'fps-target.refresh-headroom.library';
export const FPS_REFRESH_HEADROOM_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'headroom-collapse-sustained', 'headroom-collapse-observed', 'headroom-available',
  'no-display', 'no-observation', 'incomplete-headroom-evidence', 'insufficient-data'
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
    throw new RangeError(`Refresh-headroom library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireMetric(value, label) {
  if (value !== null && !nonNegative(value)) {
    throw new RangeError(`Refresh-headroom library ${label} must be null or non-negative`);
  }
  return value;
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Refresh-headroom library report must be an object');
  if (report.turbo !== 'fps-target.refresh-headroom') {
    throw new Error('Refresh-headroom library requires a refresh-headroom turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('Refresh-headroom library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Refresh-headroom library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Refresh-headroom library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Refresh-headroom library persistenceThreshold must be from 1 to 64');
  }
  if (!nonNegative(report.minimumHeadroom)) {
    throw new RangeError('Refresh-headroom library minimumHeadroom must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noDisplayCount', 'no-display count'], ['noObservationCount', 'no-observation count'],
    ['tightCount', 'tight count']
  ]) requireCount(report, field, label);
  requireMetric(report.minimumObservedHeadroom, 'minimumObservedHeadroom');
  requireMetric(report.maximumObservedHeadroom, 'maximumObservedHeadroom');
  if (!nonNegative(report.confidence) || report.confidence > 1) {
    throw new RangeError('Refresh-headroom library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Refresh-headroom library reports must be an array');
  if (reports.length > 64) throw new RangeError('Refresh-headroom library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-display')) return 'no-display';
  if (reports.some((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.some((report) => report.state === 'incomplete-headroom-evidence')) {
    return 'incomplete-headroom-evidence';
  }
  if (reports.some((report) => report.state === 'headroom-collapse-sustained')) {
    return 'headroom-collapse-sustained';
  }
  if (reports.some((report) => report.state === 'headroom-collapse-observed')) {
    return 'headroom-collapse-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'headroom-available';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-refresh-headroom-samples']);
  if (state === 'no-display') return Object.freeze(['keep-fps-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-refresh-headroom-observation']);
  if (state === 'incomplete-headroom-evidence') {
    return Object.freeze(['request-refresh-and-fps-evidence']);
  }
  if (state === 'headroom-collapse-sustained') {
    return Object.freeze(['review-refresh-headroom', 'hold-unapproved-fps-policy']);
  }
  if (state === 'headroom-collapse-observed') return Object.freeze(['observe-next-headroom-sample']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'headroom-collapse-sustained') return 'headroom-review';
  if (state === 'headroom-collapse-observed') return 'headroom-observation';
  if (state === 'no-display') return 'no-display-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'incomplete-headroom-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'headroom-available-observation';
}

function intervalFor(state, environment) {
  if (state === 'headroom-collapse-sustained') return 750;
  if (state === 'headroom-collapse-observed') return 1000;
  if (state === 'no-display') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'incomplete-headroom-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function extrema(reports, field, reducer, fallback) {
  const values = reports.map((report) => report[field]).filter((value) => value !== null);
  return values.length === 0 ? fallback : reducer(...values);
}

export function mergeFpsRefreshHeadroomReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: FPS_REFRESH_HEADROOM_LIBRARY_ID,
    libraryVersion: FPS_REFRESH_HEADROOM_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDisplayCount: validated.reduce((sum, report) => sum + report.noDisplayCount, 0),
    noObservationCount: validated.reduce((sum, report) => sum + report.noObservationCount, 0),
    tightCount: validated.reduce((sum, report) => sum + report.tightCount, 0),
    minimumObservedHeadroom: extrema(validated, 'minimumObservedHeadroom', Math.min, null),
    maximumObservedHeadroom: extrema(validated, 'maximumObservedHeadroom', Math.max, null),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildFpsRefreshHeadroomPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: FPS_REFRESH_HEADROOM_LIBRARY_ID,
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
    throw new TypeError('Refresh-headroom library clock must return a number');
  }
  return timestamp;
}

export function buildFpsRefreshHeadroomEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Refresh-headroom library trigger is required');
  }
  return Object.freeze({
    library: FPS_REFRESH_HEADROOM_LIBRARY_ID,
    libraryVersion: FPS_REFRESH_HEADROOM_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createFpsRefreshHeadroomLibrary() {
  return Object.freeze({
    id: FPS_REFRESH_HEADROOM_LIBRARY_ID,
    version: FPS_REFRESH_HEADROOM_LIBRARY_VERSION,
    merge: mergeFpsRefreshHeadroomReports,
    plan: buildFpsRefreshHeadroomPlan,
    envelope: buildFpsRefreshHeadroomEnvelope
  });
}
