/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated storage-confidence library. It validates, aggregates, and plans
 * completeness reports without importing the turbo or changing storage.
 */

export const STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_ID = 'storage-health.storage-confidence.library';
export const STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'low-confidence-sustained', 'low-confidence-observed', 'complete-storage-observation',
  'no-storage', 'incomplete-confidence-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Storage-confidence library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Storage-confidence library report must be an object');
  if (report.turbo !== 'storage-health.storage-confidence') {
    throw new Error('Storage-confidence library requires a storage-confidence turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Storage-confidence library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Storage-confidence library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Storage-confidence library minimumSamples must be from 1 to 64');
  }
  if (!Number.isFinite(report.completenessThreshold) || report.completenessThreshold < 0
    || report.completenessThreshold > 1) {
    throw new RangeError('Storage-confidence library completenessThreshold must be between 0 and 1');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Storage-confidence library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noStorageCount', 'no-storage count'], ['lowConfidenceSampleCount', 'low-confidence sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.storageCount) || report.storageCount < 0 || report.storageCount > 4096) {
    throw new RangeError('Storage-confidence library storageCount must be from 0 to 4096');
  }
  if (!Number.isInteger(report.completeCount) || report.completeCount < 0
    || report.completeCount > report.storageCount) {
    throw new RangeError('Storage-confidence library completeCount must fit inside storageCount');
  }
  if (!Number.isInteger(report.incompleteRowCount) || report.incompleteRowCount < 0
    || report.incompleteRowCount > report.storageCount) {
    throw new RangeError('Storage-confidence library incompleteRowCount must fit inside storageCount');
  }
  if (report.completenessRatio !== null
    && (!Number.isFinite(report.completenessRatio) || report.completenessRatio < 0
      || report.completenessRatio > 1)) {
    throw new RangeError('Storage-confidence library completenessRatio must be null or between 0 and 1');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Storage-confidence library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Storage-confidence library reports must be an array');
  if (reports.length > 64) throw new RangeError('Storage-confidence library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-storage')) return 'no-storage';
  if (reports.some((report) => report.state === 'incomplete-confidence-evidence')) {
    return 'incomplete-confidence-evidence';
  }
  if (reports.some((report) => report.state === 'low-confidence-sustained')) return 'low-confidence-sustained';
  if (reports.some((report) => report.state === 'low-confidence-observed')) return 'low-confidence-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'complete-storage-observation';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-storage-facts']);
  if (state === 'no-storage') return Object.freeze(['no-storage-confidence-review']);
  if (state === 'incomplete-confidence-evidence') return Object.freeze(['request-environment-profile']);
  if (state === 'low-confidence-sustained') return Object.freeze(['request-complete-storage-facts']);
  if (state === 'low-confidence-observed') return Object.freeze(['observe-storage-fact-completeness']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'low-confidence-sustained') return 'storage-fact-review';
  if (state === 'low-confidence-observed') return 'storage-fact-observation';
  if (state === 'no-storage') return 'no-storage-observation';
  if (state === 'incomplete-confidence-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'complete-storage-observation';
}

function intervalFor(state, environment) {
  if (state === 'low-confidence-sustained') return 750;
  if (state === 'low-confidence-observed') return 1000;
  if (state === 'no-storage') return 10000;
  if (state === 'incomplete-confidence-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { storageCount: 0, completeCount: 0, incompleteRowCount: 0, completenessRatio: null };
}

export function mergeStorageHealthStorageConfidenceReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_ID,
    libraryVersion: STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    storageCount: last.storageCount,
    completeCount: last.completeCount,
    incompleteRowCount: last.incompleteRowCount,
    completenessRatio: last.completenessRatio,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noStorageCount: validated.reduce((sum, report) => sum + report.noStorageCount, 0),
    lowConfidenceSampleCount: validated.reduce((sum, report) => sum + report.lowConfidenceSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildStorageHealthStorageConfidencePlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Storage-confidence library clock must return a number');
  return timestamp;
}

export function buildStorageHealthStorageConfidenceEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Storage-confidence library trigger is required');
  }
  return Object.freeze({
    library: STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_ID,
    libraryVersion: STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createStorageHealthStorageConfidenceLibrary() {
  return Object.freeze({
    id: STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_ID,
    version: STORAGE_HEALTH_STORAGE_CONFIDENCE_LIBRARY_VERSION,
    merge: mergeStorageHealthStorageConfidenceReports,
    plan: buildStorageHealthStorageConfidencePlan,
    envelope: buildStorageHealthStorageConfidenceEnvelope
  });
}
