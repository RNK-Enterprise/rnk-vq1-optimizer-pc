/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated candidate-drift library. It validates, aggregates, and plans
 * safe-candidate preview reports without importing a file-management API.
 */

export const CACHE_CANDIDATE_DRIFT_LIBRARY_ID = 'cache-cleanup.candidate-drift.library';
export const CACHE_CANDIDATE_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-preview', 'candidate-drift-observed', 'candidate-drift-sustained',
  'review-required', 'no-candidates', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Candidate-drift library report must be an object');
  if (report.turbo !== 'cache-cleanup.candidate-drift') {
    throw new Error('Candidate-drift library requires a candidate-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Candidate-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Candidate-drift library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Candidate-drift library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Candidate-drift library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['candidateCount', 'candidate count'], ['namedCandidateCount', 'named candidate count'],
    ['reviewCount', 'review count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) {
      throw new RangeError(`Candidate-drift library ${label} must be from 0 to 4096`);
    }
  }
  if (!Number.isFinite(report.candidateBytes) || report.candidateBytes < 0
    || report.candidateBytes > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Candidate-drift library candidateBytes must be a safe non-negative number');
  }
  if (!Number.isInteger(report.comparisonCount) || report.comparisonCount < 0
    || report.comparisonCount > Math.max(0, report.sampleCount - 1)) {
    throw new RangeError('Candidate-drift library comparisonCount must fit inside the sample window');
  }
  for (const [field, label] of [
    ['changeCount', 'change count'], ['sizeChangeCount', 'size-change count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.comparisonCount) {
      throw new RangeError(`Candidate-drift library ${label} must fit inside comparisonCount`);
    }
  }
  for (const [field, label] of [['addedCount', 'added count'], ['removedCount', 'removed count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) {
      throw new RangeError(`Candidate-drift library ${label} must be from 0 to 4096`);
    }
  }
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) {
    throw new TypeError('Candidate-drift library finalEnvironment must be normalized');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Candidate-drift library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Candidate-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Candidate-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'review-required')) return 'review-required';
  if (reports.some((report) => report.state === 'candidate-drift-sustained')) {
    return 'candidate-drift-sustained';
  }
  if (reports.some((report) => report.state === 'candidate-drift-observed')) {
    return 'candidate-drift-observed';
  }
  if (reports.every((report) => report.state === 'no-candidates')) return 'no-candidates';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-preview';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const complete = reports.reduce((sum, report) => sum + report.namedCandidateCount, 0);
  const candidates = reports.reduce((sum, report) => sum + report.candidateCount, 0);
  return Math.round((complete / Math.max(1, candidates)) * Math.min(1, samples / reports.length) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-candidate-samples']);
  if (state === 'no-candidates') return Object.freeze(['no-cache-cleanup-review']);
  if (state === 'review-required') return Object.freeze(['review-cache-ownership']);
  if (state === 'candidate-drift-sustained') return Object.freeze(['review-candidate-drift-without-file-mutation']);
  if (state === 'candidate-drift-observed') return Object.freeze(['observe-candidate-stability']);
  return Object.freeze(['preview-safe-cache-candidates']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'review-required') return 'ownership-review';
  if (state === 'candidate-drift-sustained') return 'candidate-review';
  if (state === 'candidate-drift-observed') return 'candidate-observation';
  if (state === 'no-candidates') return 'empty-observation';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}

function intervalFor(state, environment) {
  if (state === 'review-required') return 750;
  if (state === 'candidate-drift-sustained') return 1000;
  if (state === 'candidate-drift-observed') return 1500;
  if (state === 'no-candidates') return 10000;
  if (state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeCacheCandidateDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const latest = validated.at(-1);
  return Object.freeze({
    library: CACHE_CANDIDATE_DRIFT_LIBRARY_ID,
    libraryVersion: CACHE_CANDIDATE_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    candidateCount: latest?.candidateCount || 0,
    namedCandidateCount: validated.reduce((sum, report) => sum + report.namedCandidateCount, 0),
    candidateBytes: latest?.candidateBytes || 0,
    reviewCount: validated.reduce((sum, report) => sum + report.reviewCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0),
    addedCount: validated.reduce((sum, report) => sum + report.addedCount, 0),
    removedCount: validated.reduce((sum, report) => sum + report.removedCount, 0),
    sizeChangeCount: validated.reduce((sum, report) => sum + report.sizeChangeCount, 0),
    finalEnvironment: latest?.finalEnvironment || 'unknown',
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildCacheCandidateDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CACHE_CANDIDATE_DRIFT_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0 ? 0
      : Math.round((validated.namedCandidateCount / Math.max(1, validated.candidateCount)) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Candidate-drift library clock must return a number');
  return timestamp;
}

export function buildCacheCandidateDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Candidate-drift library trigger is required');
  }
  return Object.freeze({
    library: CACHE_CANDIDATE_DRIFT_LIBRARY_ID,
    libraryVersion: CACHE_CANDIDATE_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCacheCandidateDriftLibrary() {
  return Object.freeze({
    id: CACHE_CANDIDATE_DRIFT_LIBRARY_ID,
    version: CACHE_CANDIDATE_DRIFT_LIBRARY_VERSION,
    merge: mergeCacheCandidateDriftReports,
    plan: buildCacheCandidateDriftPlan,
    envelope: buildCacheCandidateDriftEnvelope
  });
}
