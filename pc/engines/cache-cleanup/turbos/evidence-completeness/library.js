/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated evidence-completeness library. It validates, aggregates, and
 * plans cache metadata evidence without importing a file-management API.
 */

export const CACHE_EVIDENCE_LIBRARY_ID = 'cache-cleanup.evidence-completeness.library';
export const CACHE_EVIDENCE_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'complete-evidence', 'evidence-drift-observed', 'evidence-drift-sustained',
  'incomplete-evidence', 'no-cache-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Evidence library report must be an object');
  if (report.turbo !== 'cache-cleanup.evidence-completeness') {
    throw new Error('Evidence library requires an evidence-completeness turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Evidence library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Evidence library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Evidence library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Evidence library persistenceThreshold must be from 1 to 64');
  }
  if (!Number.isFinite(report.minimumCompleteness) || report.minimumCompleteness < 0
    || report.minimumCompleteness > 1) {
    throw new RangeError('Evidence library minimumCompleteness must be between 0 and 1');
  }
  for (const [field, label] of [
    ['cacheCount', 'cache count'], ['completeCount', 'complete count'], ['incompleteCount', 'incomplete count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) {
      throw new RangeError(`Evidence library ${label} must be from 0 to 4096`);
    }
  }
  if (!Number.isFinite(report.completeness) || report.completeness < 0 || report.completeness > 1) {
    throw new RangeError('Evidence library completeness must be between 0 and 1');
  }
  if (!Number.isInteger(report.comparisonCount) || report.comparisonCount < 0
    || report.comparisonCount > Math.max(0, report.sampleCount - 1)) {
    throw new RangeError('Evidence library comparisonCount must fit inside the sample window');
  }
  for (const [field, label] of [
    ['changeCount', 'change count'], ['completenessChangeCount', 'completeness-change count'],
    ['incompleteChangeCount', 'incomplete-change count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.comparisonCount) {
      throw new RangeError(`Evidence library ${label} must fit inside comparisonCount`);
    }
  }
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) {
    throw new TypeError('Evidence library finalEnvironment must be normalized');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Evidence library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Evidence library reports must be an array');
  if (reports.length > 64) throw new RangeError('Evidence library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'incomplete-evidence')) return 'incomplete-evidence';
  if (reports.some((report) => report.state === 'evidence-drift-sustained')) {
    return 'evidence-drift-sustained';
  }
  if (reports.some((report) => report.state === 'evidence-drift-observed')) {
    return 'evidence-drift-observed';
  }
  if (reports.every((report) => report.state === 'no-cache-evidence')) return 'no-cache-evidence';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'complete-evidence';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const latest = reports.at(-1);
  return latest.cacheCount === 0 ? 0 : latest.completeness;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-evidence-samples']);
  if (state === 'no-cache-evidence') return Object.freeze(['no-cache-cleanup-review']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-complete-cache-metadata']);
  if (state === 'evidence-drift-sustained') return Object.freeze(['review-cache-evidence-drift']);
  if (state === 'evidence-drift-observed') return Object.freeze(['observe-cache-evidence-stability']);
  return Object.freeze(['preview-safe-cache-candidates']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'incomplete-evidence') return 'metadata-bootstrap';
  if (state === 'evidence-drift-sustained') return 'evidence-review';
  if (state === 'evidence-drift-observed') return 'evidence-observation';
  if (state === 'no-cache-evidence') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}

function intervalFor(state, environment) {
  if (state === 'incomplete-evidence') return 750;
  if (state === 'evidence-drift-sustained') return 1000;
  if (state === 'evidence-drift-observed') return 1500;
  if (state === 'no-cache-evidence' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeCacheEvidenceReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const latest = validated.at(-1);
  return Object.freeze({
    library: CACHE_EVIDENCE_LIBRARY_ID,
    libraryVersion: CACHE_EVIDENCE_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    cacheCount: latest?.cacheCount || 0,
    completeCount: latest?.completeCount || 0,
    incompleteCount: latest?.incompleteCount || 0,
    completeness: latest?.completeness || 0,
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0),
    completenessChangeCount: validated.reduce((sum, report) => sum + report.completenessChangeCount, 0),
    incompleteChangeCount: validated.reduce((sum, report) => sum + report.incompleteChangeCount, 0),
    finalEnvironment: latest?.finalEnvironment || 'unknown',
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildCacheEvidencePlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CACHE_EVIDENCE_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0 ? 0 : validated.completeness
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Evidence library clock must return a number');
  return timestamp;
}

export function buildCacheEvidenceEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Evidence library trigger is required');
  }
  return Object.freeze({
    library: CACHE_EVIDENCE_LIBRARY_ID,
    libraryVersion: CACHE_EVIDENCE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCacheEvidenceLibrary() {
  return Object.freeze({
    id: CACHE_EVIDENCE_LIBRARY_ID,
    version: CACHE_EVIDENCE_LIBRARY_VERSION,
    merge: mergeCacheEvidenceReports,
    plan: buildCacheEvidencePlan,
    envelope: buildCacheEvidenceEnvelope
  });
}
