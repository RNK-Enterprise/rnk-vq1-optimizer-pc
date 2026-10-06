/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated read-only-drift library. It validates, aggregates, and plans
 * read-only reports without importing the turbo or changing storage.
 */

export const STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_ID = 'storage-health.read-only-drift.library';
export const STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'read-only-increase-sustained', 'read-only-observed', 'stable-read-only',
  'no-storage', 'incomplete-read-only-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Read-only-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Read-only-drift library report must be an object');
  if (report.turbo !== 'storage-health.read-only-drift') {
    throw new Error('Read-only-drift library requires a read-only-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Read-only-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Read-only-drift library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Read-only-drift library minimumSamples must be from 1 to 64');
  }
  if (!Number.isFinite(report.readOnlyThreshold) || report.readOnlyThreshold < 0 || report.readOnlyThreshold > 1) {
    throw new RangeError('Read-only-drift library readOnlyThreshold must be between 0 and 1');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Read-only-drift library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noStorageCount', 'no-storage count'], ['elevatedSampleCount', 'elevated sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.storageCount) || report.storageCount < 0 || report.storageCount > 4096) {
    throw new RangeError('Read-only-drift library storageCount must be from 0 to 4096');
  }
  if (!Number.isInteger(report.readOnlyCount) || report.readOnlyCount < 0
    || report.readOnlyCount > report.storageCount) {
    throw new RangeError('Read-only-drift library readOnlyCount must fit inside storageCount');
  }
  if (report.readOnlyRatio !== null
    && (!Number.isFinite(report.readOnlyRatio) || report.readOnlyRatio < 0 || report.readOnlyRatio > 1)) {
    throw new RangeError('Read-only-drift library readOnlyRatio must be null or between 0 and 1');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Read-only-drift library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Read-only-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Read-only-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-storage')) return 'no-storage';
  if (reports.some((report) => report.state === 'incomplete-read-only-evidence')) {
    return 'incomplete-read-only-evidence';
  }
  if (reports.some((report) => report.state === 'read-only-increase-sustained')) {
    return 'read-only-increase-sustained';
  }
  if (reports.some((report) => report.state === 'read-only-observed')) return 'read-only-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-read-only';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-read-only-samples']);
  if (state === 'no-storage') return Object.freeze(['no-storage-read-only-review']);
  if (state === 'incomplete-read-only-evidence') return Object.freeze(['request-read-only-observation']);
  if (state === 'read-only-increase-sustained') return Object.freeze(['review-mount-state', 'hold-remount-policy']);
  if (state === 'read-only-observed') return Object.freeze(['observe-read-only-state']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'read-only-increase-sustained') return 'read-only-mount-review';
  if (state === 'read-only-observed') return 'read-only-observation';
  if (state === 'no-storage') return 'no-storage-observation';
  if (state === 'incomplete-read-only-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-read-only-observation';
}

function intervalFor(state, environment) {
  if (state === 'read-only-increase-sustained') return 750;
  if (state === 'read-only-observed') return 1000;
  if (state === 'no-storage') return 10000;
  if (state === 'incomplete-read-only-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { storageCount: 0, readOnlyCount: 0, readOnlyRatio: null };
}

export function mergeStorageHealthReadOnlyDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_ID,
    libraryVersion: STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    storageCount: last.storageCount,
    readOnlyCount: last.readOnlyCount,
    readOnlyRatio: last.readOnlyRatio,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noStorageCount: validated.reduce((sum, report) => sum + report.noStorageCount, 0),
    elevatedSampleCount: validated.reduce((sum, report) => sum + report.elevatedSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildStorageHealthReadOnlyDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Read-only-drift library clock must return a number');
  return timestamp;
}

export function buildStorageHealthReadOnlyDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Read-only-drift library trigger is required');
  }
  return Object.freeze({
    library: STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_ID,
    libraryVersion: STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createStorageHealthReadOnlyDriftLibrary() {
  return Object.freeze({
    id: STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_ID,
    version: STORAGE_HEALTH_READ_ONLY_DRIFT_LIBRARY_VERSION,
    merge: mergeStorageHealthReadOnlyDriftReports,
    plan: buildStorageHealthReadOnlyDriftPlan,
    envelope: buildStorageHealthReadOnlyDriftEnvelope
  });
}
