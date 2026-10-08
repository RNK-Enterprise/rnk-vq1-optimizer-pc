/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated safety-evidence library. It validates, aggregates, and plans risk
 * reports without importing the turbo or changing network state.
 */

export const NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_ID = 'network-safety.safety-evidence.library';
export const NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'review-risk-sustained', 'review-risk-observed', 'unknown-risk-evidence',
  'observed-safe-evidence', 'no-network', 'incomplete-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Safety-evidence library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Safety-evidence library report must be an object');
  if (report.turbo !== 'network-safety.safety-evidence') {
    throw new Error('Safety-evidence library requires a safety-evidence turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Safety-evidence library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Safety-evidence library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Safety-evidence library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Safety-evidence library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedSampleCount', 'observed sample count'], ['incompleteCount', 'incomplete count'],
    ['noNetworkCount', 'no-network count'], ['reviewSampleCount', 'review sample count'],
    ['unknownSampleCount', 'unknown sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.linkCount) || report.linkCount < 0 || report.linkCount > 4096) {
    throw new RangeError('Safety-evidence library linkCount must be from 0 to 4096');
  }
  for (const [field, label] of [
    ['reviewCount', 'review count'], ['unknownCount', 'unknown count'], ['observedCount', 'observed count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.linkCount) {
      throw new RangeError(`Safety-evidence library ${label} must fit inside linkCount`);
    }
  }
  if (!Number.isInteger(report.riskChangeCount) || report.riskChangeCount < 0
    || report.riskChangeCount > 4096) {
    throw new RangeError('Safety-evidence library riskChangeCount must be from 0 to 4096');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Safety-evidence library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Safety-evidence library reports must be an array');
  if (reports.length > 64) throw new RangeError('Safety-evidence library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-network')) return 'no-network';
  if (reports.some((report) => report.state === 'incomplete-evidence')) return 'incomplete-evidence';
  if (reports.some((report) => report.state === 'review-risk-sustained')) return 'review-risk-sustained';
  if (reports.some((report) => report.state === 'review-risk-observed')) return 'review-risk-observed';
  if (reports.some((report) => report.state === 'unknown-risk-evidence')) return 'unknown-risk-evidence';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'observed-safe-evidence';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedSampleCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-safety-evidence']);
  if (state === 'no-network') return Object.freeze(['no-network-safety-review']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-network-environment-profile']);
  if (state === 'review-risk-sustained') return Object.freeze(['review-network-safety-evidence-without-network-mutation']);
  if (state === 'review-risk-observed') return Object.freeze(['observe-network-safety-review-state']);
  if (state === 'unknown-risk-evidence') return Object.freeze(['request-network-safety-observation']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'review-risk-sustained') return 'safety-review';
  if (state === 'review-risk-observed') return 'safety-observation';
  if (state === 'unknown-risk-evidence') return 'evidence-bootstrap';
  if (state === 'no-network') return 'no-network-observation';
  if (state === 'incomplete-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'observed-safety-monitoring';
}

function intervalFor(state, environment) {
  if (state === 'review-risk-sustained') return 750;
  if (state === 'review-risk-observed') return 1000;
  if (state === 'unknown-risk-evidence') return 1500;
  if (state === 'no-network') return 10000;
  if (state === 'incomplete-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { linkCount: 0, reviewCount: 0, unknownCount: 0, observedCount: 0, riskChangeCount: 0 };
}

export function mergeNetworkSafetySafetyEvidenceReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_ID,
    libraryVersion: NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    linkCount: last.linkCount,
    reviewCount: last.reviewCount,
    unknownCount: last.unknownCount,
    observedCount: last.observedCount,
    riskChangeCount: last.riskChangeCount,
    observedSampleCount: validated.reduce((sum, report) => sum + report.observedSampleCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noNetworkCount: validated.reduce((sum, report) => sum + report.noNetworkCount, 0),
    reviewSampleCount: validated.reduce((sum, report) => sum + report.reviewSampleCount, 0),
    unknownSampleCount: validated.reduce((sum, report) => sum + report.unknownSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildNetworkSafetySafetyEvidencePlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0 ? 0
      : Math.round((validated.observedSampleCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Safety-evidence library clock must return a number');
  return timestamp;
}

export function buildNetworkSafetySafetyEvidenceEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Safety-evidence library trigger is required');
  }
  return Object.freeze({
    library: NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_ID,
    libraryVersion: NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createNetworkSafetySafetyEvidenceLibrary() {
  return Object.freeze({
    id: NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_ID,
    version: NETWORK_SAFETY_SAFETY_EVIDENCE_LIBRARY_VERSION,
    merge: mergeNetworkSafetySafetyEvidenceReports,
    plan: buildNetworkSafetySafetyEvidencePlan,
    envelope: buildNetworkSafetySafetyEvidenceEnvelope
  });
}
