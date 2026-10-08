/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated link-health library. It validates, aggregates, and plans link-state
 * evidence without importing the turbo or changing network state.
 */

export const NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_ID = 'network-observation.link-health.library';
export const NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'link-health-drift-sustained', 'link-health-drift-observed', 'stable-link-health',
  'no-network', 'incomplete-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Link-health library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Link-health library report must be an object');
  if (report.turbo !== 'network-observation.link-health') {
    throw new Error('Link-health library requires a link-health turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Link-health library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Link-health library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Link-health library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Link-health library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noNetworkCount', 'no-network count'], ['comparisonCount', 'comparison count'],
    ['stateChangeSampleCount', 'state-change sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.linkCount) || report.linkCount < 0 || report.linkCount > 4096) {
    throw new RangeError('Link-health library linkCount must be from 0 to 4096');
  }
  if (!Number.isInteger(report.unknownStateCount) || report.unknownStateCount < 0
    || report.unknownStateCount > report.linkCount) {
    throw new RangeError('Link-health library unknownStateCount must fit inside linkCount');
  }
  if (!Number.isInteger(report.stateChangeCount) || report.stateChangeCount < 0
    || report.stateChangeCount > 4096) {
    throw new RangeError('Link-health library stateChangeCount must be from 0 to 4096');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Link-health library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Link-health library reports must be an array');
  if (reports.length > 64) throw new RangeError('Link-health library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-network')) return 'no-network';
  if (reports.some((report) => report.state === 'incomplete-evidence')) return 'incomplete-evidence';
  if (reports.some((report) => report.state === 'link-health-drift-sustained')) return 'link-health-drift-sustained';
  if (reports.some((report) => report.state === 'link-health-drift-observed')) return 'link-health-drift-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-link-health';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-link-state-evidence']);
  if (state === 'no-network') return Object.freeze(['no-network-link-review']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-link-state-evidence']);
  if (state === 'link-health-drift-sustained') return Object.freeze(['review-link-state-drift-without-network-mutation']);
  if (state === 'link-health-drift-observed') return Object.freeze(['observe-link-state-stability']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'link-health-drift-sustained') return 'link-state-review';
  if (state === 'link-health-drift-observed') return 'link-state-observation';
  if (state === 'no-network') return 'no-network-observation';
  if (state === 'incomplete-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-link-state-observation';
}

function intervalFor(state, environment) {
  if (state === 'link-health-drift-sustained') return 750;
  if (state === 'link-health-drift-observed') return 1000;
  if (state === 'no-network') return 10000;
  if (state === 'incomplete-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { linkCount: 0, unknownStateCount: 0, stateChangeCount: 0 };
}

export function mergeNetworkObservationLinkHealthReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_ID,
    libraryVersion: NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    linkCount: last.linkCount,
    unknownStateCount: last.unknownStateCount,
    stateChangeCount: last.stateChangeCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noNetworkCount: validated.reduce((sum, report) => sum + report.noNetworkCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    stateChangeSampleCount: validated.reduce((sum, report) => sum + report.stateChangeSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildNetworkObservationLinkHealthPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Link-health library clock must return a number');
  return timestamp;
}

export function buildNetworkObservationLinkHealthEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Link-health library trigger is required');
  }
  return Object.freeze({
    library: NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_ID,
    libraryVersion: NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createNetworkObservationLinkHealthLibrary() {
  return Object.freeze({
    id: NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_ID,
    version: NETWORK_OBSERVATION_LINK_HEALTH_LIBRARY_VERSION,
    merge: mergeNetworkObservationLinkHealthReports,
    plan: buildNetworkObservationLinkHealthPlan,
    envelope: buildNetworkObservationLinkHealthEnvelope
  });
}
