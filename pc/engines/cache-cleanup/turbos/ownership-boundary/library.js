/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated ownership-boundary library. It validates, aggregates, and plans
 * cache ownership reports without inferring file-operation permission.
 */

export const CACHE_OWNERSHIP_LIBRARY_ID = 'cache-cleanup.ownership-boundary.library';
export const CACHE_OWNERSHIP_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-ownership', 'ownership-drift-observed', 'ownership-drift-sustained',
  'user-owned-present', 'ambiguous-review', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Ownership library report must be an object');
  if (report.turbo !== 'cache-cleanup.ownership-boundary') {
    throw new Error('Ownership library requires an ownership-boundary turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Ownership library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Ownership library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Ownership library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Ownership library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['cacheCount', 'cache count'], ['userOwnedCount', 'user-owned count'],
    ['systemSafeCount', 'system-safe count'], ['ambiguousCount', 'ambiguous count'],
    ['knownCount', 'known count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) {
      throw new RangeError(`Ownership library ${label} must be from 0 to 4096`);
    }
  }
  if (!Number.isInteger(report.comparisonCount) || report.comparisonCount < 0
    || report.comparisonCount > Math.max(0, report.sampleCount - 1)) {
    throw new RangeError('Ownership library comparisonCount must fit inside the sample window');
  }
  if (!Number.isInteger(report.changeCount) || report.changeCount < 0
    || report.changeCount > report.comparisonCount) {
    throw new RangeError('Ownership library changeCount must fit inside comparisonCount');
  }
  for (const [field, label] of [
    ['userOwnedChangeCount', 'user-owned change count'],
    ['systemSafeChangeCount', 'system-safe change count'],
    ['ambiguousChangeCount', 'ambiguous change count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.comparisonCount) {
      throw new RangeError(`Ownership library ${label} must fit inside comparisonCount`);
    }
  }
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) {
    throw new TypeError('Ownership library finalEnvironment must be normalized');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Ownership library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Ownership library reports must be an array');
  if (reports.length > 64) throw new RangeError('Ownership library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'user-owned-present')) return 'user-owned-present';
  if (reports.some((report) => report.state === 'ambiguous-review')) return 'ambiguous-review';
  if (reports.some((report) => report.state === 'ownership-drift-sustained')) {
    return 'ownership-drift-sustained';
  }
  if (reports.some((report) => report.state === 'ownership-drift-observed')) {
    return 'ownership-drift-observed';
  }
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-ownership';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const latest = reports.at(-1);
  if (latest.cacheCount === 0) return 0;
  return Math.round((latest.knownCount / latest.cacheCount) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-ownership-samples']);
  if (state === 'user-owned-present') return Object.freeze(['preserve-user-owned-cache-boundary']);
  if (state === 'ambiguous-review') return Object.freeze(['review-ambiguous-cache-ownership']);
  if (state === 'ownership-drift-sustained') return Object.freeze(['review-ownership-drift-without-file-mutation']);
  if (state === 'ownership-drift-observed') return Object.freeze(['observe-cache-ownership-stability']);
  return Object.freeze(['preview-safe-cache-candidates']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'user-owned-present') return 'user-boundary';
  if (state === 'ambiguous-review') return 'ownership-review';
  if (state === 'ownership-drift-sustained') return 'ownership-review';
  if (state === 'ownership-drift-observed') return 'ownership-observation';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}

function intervalFor(state, environment) {
  if (state === 'user-owned-present' || state === 'ambiguous-review') return 750;
  if (state === 'ownership-drift-sustained') return 1000;
  if (state === 'ownership-drift-observed') return 1500;
  if (state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeCacheOwnershipReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const latest = validated.at(-1);
  return Object.freeze({
    library: CACHE_OWNERSHIP_LIBRARY_ID,
    libraryVersion: CACHE_OWNERSHIP_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    cacheCount: latest?.cacheCount || 0,
    userOwnedCount: latest?.userOwnedCount || 0,
    systemSafeCount: latest?.systemSafeCount || 0,
    ambiguousCount: latest?.ambiguousCount || 0,
    knownCount: latest?.knownCount || 0,
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0),
    userOwnedChangeCount: validated.reduce((sum, report) => sum + report.userOwnedChangeCount, 0),
    systemSafeChangeCount: validated.reduce((sum, report) => sum + report.systemSafeChangeCount, 0),
    ambiguousChangeCount: validated.reduce((sum, report) => sum + report.ambiguousChangeCount, 0),
    finalEnvironment: latest?.finalEnvironment || 'unknown',
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildCacheOwnershipPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CACHE_OWNERSHIP_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.cacheCount === 0 ? 0
      : Math.round((validated.knownCount / validated.cacheCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Ownership library clock must return a number');
  return timestamp;
}

export function buildCacheOwnershipEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Ownership library trigger is required');
  }
  return Object.freeze({
    library: CACHE_OWNERSHIP_LIBRARY_ID,
    libraryVersion: CACHE_OWNERSHIP_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCacheOwnershipLibrary() {
  return Object.freeze({
    id: CACHE_OWNERSHIP_LIBRARY_ID,
    version: CACHE_OWNERSHIP_LIBRARY_VERSION,
    merge: mergeCacheOwnershipReports,
    plan: buildCacheOwnershipPlan,
    envelope: buildCacheOwnershipEnvelope
  });
}
