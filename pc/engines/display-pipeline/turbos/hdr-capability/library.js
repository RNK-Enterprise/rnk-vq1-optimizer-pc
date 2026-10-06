/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated HDR-capability library. It validates, aggregates, and plans HDR
 * reports without importing the turbo or changing display policy.
 */

export const DISPLAY_HDR_CAPABILITY_LIBRARY_ID = 'display-pipeline.hdr-capability.library';
export const DISPLAY_HDR_CAPABILITY_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'hdr-drift-sustained', 'hdr-drift-observed', 'hdr-enabled', 'hdr-disabled',
  'hdr-observed', 'no-display', 'no-observation', 'incomplete-hdr-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`HDR-capability library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('HDR-capability library report must be an object');
  if (report.turbo !== 'display-pipeline.hdr-capability') {
    throw new Error('HDR-capability library requires an HDR-capability turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('HDR-capability library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('HDR-capability library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('HDR-capability library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.changeThreshold) || report.changeThreshold < 1 || report.changeThreshold > 64) {
    throw new RangeError('HDR-capability library changeThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['enabledCount', 'enabled count'],
    ['disabledCount', 'disabled count'], ['incompleteCount', 'incomplete count'],
    ['noDisplayCount', 'no-display count'], ['noObservationCount', 'no-observation count'],
    ['transitionCount', 'transition count'], ['comparisonCount', 'comparison count']
  ]) requireCount(report, field, label);
  if (report.latestHdr !== null && typeof report.latestHdr !== 'boolean') {
    throw new TypeError('HDR-capability library latestHdr must be boolean or null');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('HDR-capability library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('HDR-capability library reports must be an array');
  if (reports.length > 64) throw new RangeError('HDR-capability library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-display')) return 'no-display';
  if (reports.some((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.some((report) => report.state === 'incomplete-hdr-evidence')) return 'incomplete-hdr-evidence';
  if (reports.some((report) => report.state === 'hdr-drift-sustained')) return 'hdr-drift-sustained';
  if (reports.some((report) => report.state === 'hdr-drift-observed')) return 'hdr-drift-observed';
  if (reports.every((report) => report.state === 'hdr-enabled')) return 'hdr-enabled';
  if (reports.every((report) => report.state === 'hdr-disabled')) return 'hdr-disabled';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'hdr-observed';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  const byState = {
    'insufficient-data': ['collect-more-hdr-samples'],
    'no-display': ['keep-display-controls-disabled'],
    'no-observation': ['request-hdr-observation'],
    'incomplete-hdr-evidence': ['request-complete-hdr-evidence'],
    'hdr-drift-sustained': ['review-hdr-stability', 'hold-unapproved-display-policy'],
    'hdr-drift-observed': ['observe-next-hdr-sample'],
    'hdr-enabled': ['preserve-observed-hdr-state'],
    'hdr-disabled': ['preserve-observed-sdr-state'],
    'hdr-observed': ['no-change']
  };
  return Object.freeze(byState[state]);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  const modes = {
    'hdr-drift-sustained': 'hdr-review',
    'hdr-drift-observed': 'hdr-observation',
    'hdr-enabled': 'hdr-state-observation',
    'hdr-disabled': 'hdr-state-observation',
    'hdr-observed': 'hdr-state-observation',
    'no-display': 'no-display-observation',
    'no-observation': 'observation-bootstrap',
    'incomplete-hdr-evidence': 'evidence-bootstrap',
    'insufficient-data': 'sample-bootstrap'
  };
  return modes[state];
}

function intervalFor(state, environment) {
  if (state === 'hdr-drift-sustained') return 750;
  if (state === 'hdr-drift-observed') return 1000;
  if (state === 'no-display') return 10000;
  if (state === 'no-observation') return 2000;
  if (state === 'incomplete-hdr-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeDisplayHdrCapabilityReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: DISPLAY_HDR_CAPABILITY_LIBRARY_ID,
    libraryVersion: DISPLAY_HDR_CAPABILITY_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    enabledCount: validated.reduce((sum, report) => sum + report.enabledCount, 0),
    disabledCount: validated.reduce((sum, report) => sum + report.disabledCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDisplayCount: validated.reduce((sum, report) => sum + report.noDisplayCount, 0),
    noObservationCount: validated.reduce((sum, report) => sum + report.noObservationCount, 0),
    transitionCount: validated.reduce((sum, report) => sum + report.transitionCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    latestHdr: validated.at(-1)?.latestHdr ?? null,
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildDisplayHdrCapabilityPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: DISPLAY_HDR_CAPABILITY_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('HDR-capability library clock must return a number');
  return timestamp;
}

export function buildDisplayHdrCapabilityEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('HDR-capability library trigger is required');
  }
  return Object.freeze({
    library: DISPLAY_HDR_CAPABILITY_LIBRARY_ID,
    libraryVersion: DISPLAY_HDR_CAPABILITY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createDisplayHdrCapabilityLibrary() {
  return Object.freeze({
    id: DISPLAY_HDR_CAPABILITY_LIBRARY_ID,
    version: DISPLAY_HDR_CAPABILITY_LIBRARY_VERSION,
    merge: mergeDisplayHdrCapabilityReports,
    plan: buildDisplayHdrCapabilityPlan,
    envelope: buildDisplayHdrCapabilityEnvelope
  });
}
