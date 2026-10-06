/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated health-degradation library. It validates, aggregates, and plans
 * storage health reports without importing the turbo or changing storage.
 */

export const STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_ID = 'storage-health.health-degradation.library';
export const STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'health-failure-sustained', 'health-degradation-observed', 'healthy-storage',
  'no-storage', 'incomplete-health-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Health-degradation library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Health-degradation library report must be an object');
  if (report.turbo !== 'storage-health.health-degradation') {
    throw new Error('Health-degradation library requires a health-degradation turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Health-degradation library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Health-degradation library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Health-degradation library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Health-degradation library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noStorageCount', 'no-storage count'], ['failureSampleCount', 'failure sample count'],
    ['degradationSampleCount', 'degradation sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.storageCount) || report.storageCount < 0 || report.storageCount > 4096) {
    throw new RangeError('Health-degradation library storageCount must be from 0 to 4096');
  }
  for (const [field, label] of [['failedCount', 'failed count'], ['degradedCount', 'degraded count'],
    ['unknownCount', 'unknown count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.storageCount) {
      throw new RangeError(`Health-degradation library ${label} must fit inside storageCount`);
    }
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Health-degradation library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Health-degradation library reports must be an array');
  if (reports.length > 64) throw new RangeError('Health-degradation library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-storage')) return 'no-storage';
  if (reports.some((report) => report.state === 'incomplete-health-evidence')) {
    return 'incomplete-health-evidence';
  }
  if (reports.some((report) => report.state === 'health-failure-sustained')) {
    return 'health-failure-sustained';
  }
  if (reports.some((report) => report.state === 'health-degradation-observed')) {
    return 'health-degradation-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'healthy-storage';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-health-samples']);
  if (state === 'no-storage') return Object.freeze(['no-storage-health-review']);
  if (state === 'incomplete-health-evidence') return Object.freeze(['request-health-observation']);
  if (state === 'health-failure-sustained') return Object.freeze(['protect-data', 'request-user-approved-storage-review']);
  if (state === 'health-degradation-observed') return Object.freeze(['observe-storage-health']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'health-failure-sustained') return 'storage-failure-review';
  if (state === 'health-degradation-observed') return 'storage-health-observation';
  if (state === 'no-storage') return 'no-storage-observation';
  if (state === 'incomplete-health-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'healthy-storage-observation';
}

function intervalFor(state, environment) {
  if (state === 'health-failure-sustained') return 750;
  if (state === 'health-degradation-observed') return 1000;
  if (state === 'no-storage') return 10000;
  if (state === 'incomplete-health-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { storageCount: 0, failedCount: 0, degradedCount: 0, unknownCount: 0 };
}

export function mergeStorageHealthHealthDegradationReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_ID,
    libraryVersion: STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    storageCount: last.storageCount,
    failedCount: last.failedCount,
    degradedCount: last.degradedCount,
    unknownCount: last.unknownCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noStorageCount: validated.reduce((sum, report) => sum + report.noStorageCount, 0),
    failureSampleCount: validated.reduce((sum, report) => sum + report.failureSampleCount, 0),
    degradationSampleCount: validated.reduce((sum, report) => sum + report.degradationSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildStorageHealthHealthDegradationPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Health-degradation library clock must return a number');
  return timestamp;
}

export function buildStorageHealthHealthDegradationEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Health-degradation library trigger is required');
  }
  return Object.freeze({
    library: STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_ID,
    libraryVersion: STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createStorageHealthHealthDegradationLibrary() {
  return Object.freeze({
    id: STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_ID,
    version: STORAGE_HEALTH_HEALTH_DEGRADATION_LIBRARY_VERSION,
    merge: mergeStorageHealthHealthDegradationReports,
    plan: buildStorageHealthHealthDegradationPlan,
    envelope: buildStorageHealthHealthDegradationEnvelope
  });
}
