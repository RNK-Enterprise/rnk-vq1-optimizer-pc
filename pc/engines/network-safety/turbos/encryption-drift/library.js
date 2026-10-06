/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated encryption-drift library. It validates, aggregates, and plans
 * encryption reports without importing the turbo or changing network state.
 */

export const NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_ID = 'network-safety.encryption-drift.library';
export const NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'encryption-drift-sustained', 'encryption-drift-observed', 'stable-encryption',
  'no-network', 'incomplete-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Encryption-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Encryption-drift library report must be an object');
  if (report.turbo !== 'network-safety.encryption-drift') {
    throw new Error('Encryption-drift library requires an encryption-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Encryption-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Encryption-drift library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Encryption-drift library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Encryption-drift library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noNetworkCount', 'no-network count'], ['comparisonCount', 'comparison count'],
    ['encryptionChangeSampleCount', 'encryption-change sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.linkCount) || report.linkCount < 0 || report.linkCount > 4096) {
    throw new RangeError('Encryption-drift library linkCount must be from 0 to 4096');
  }
  for (const [field, label] of [['encryptedCount', 'encrypted count'], ['unknownEncryptionCount', 'unknown-encryption count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.linkCount) {
      throw new RangeError(`Encryption-drift library ${label} must fit inside linkCount`);
    }
  }
  if (!Number.isInteger(report.encryptionChangeCount) || report.encryptionChangeCount < 0
    || report.encryptionChangeCount > 4096) {
    throw new RangeError('Encryption-drift library encryptionChangeCount must be from 0 to 4096');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Encryption-drift library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Encryption-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Encryption-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-network')) return 'no-network';
  if (reports.some((report) => report.state === 'incomplete-evidence')) return 'incomplete-evidence';
  if (reports.some((report) => report.state === 'encryption-drift-sustained')) return 'encryption-drift-sustained';
  if (reports.some((report) => report.state === 'encryption-drift-observed')) return 'encryption-drift-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-encryption';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-encryption-evidence']);
  if (state === 'no-network') return Object.freeze(['no-network-encryption-review']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-explicit-encryption-evidence']);
  if (state === 'encryption-drift-sustained') return Object.freeze(['review-encryption-drift-without-network-mutation']);
  if (state === 'encryption-drift-observed') return Object.freeze(['observe-encryption-stability']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'encryption-drift-sustained') return 'encryption-review';
  if (state === 'encryption-drift-observed') return 'encryption-observation';
  if (state === 'no-network') return 'no-network-observation';
  if (state === 'incomplete-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-encryption-observation';
}

function intervalFor(state, environment) {
  if (state === 'encryption-drift-sustained') return 750;
  if (state === 'encryption-drift-observed') return 1000;
  if (state === 'no-network') return 10000;
  if (state === 'incomplete-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { linkCount: 0, encryptedCount: 0, unknownEncryptionCount: 0, encryptionChangeCount: 0 };
}

export function mergeNetworkSafetyEncryptionDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_ID,
    libraryVersion: NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    linkCount: last.linkCount,
    encryptedCount: last.encryptedCount,
    unknownEncryptionCount: last.unknownEncryptionCount,
    encryptionChangeCount: last.encryptionChangeCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noNetworkCount: validated.reduce((sum, report) => sum + report.noNetworkCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    encryptionChangeSampleCount: validated.reduce((sum, report) => sum + report.encryptionChangeSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildNetworkSafetyEncryptionDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Encryption-drift library clock must return a number');
  return timestamp;
}

export function buildNetworkSafetyEncryptionDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Encryption-drift library trigger is required');
  }
  return Object.freeze({
    library: NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_ID,
    libraryVersion: NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createNetworkSafetyEncryptionDriftLibrary() {
  return Object.freeze({
    id: NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_ID,
    version: NETWORK_SAFETY_ENCRYPTION_DRIFT_LIBRARY_VERSION,
    merge: mergeNetworkSafetyEncryptionDriftReports,
    plan: buildNetworkSafetyEncryptionDriftPlan,
    envelope: buildNetworkSafetyEncryptionDriftEnvelope
  });
}
