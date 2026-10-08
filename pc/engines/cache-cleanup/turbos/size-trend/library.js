/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated size-trend library. It validates, aggregates, and plans cache
 * size reports without importing a file-management API.
 */

export const CACHE_SIZE_TREND_LIBRARY_ID = 'cache-cleanup.size-trend.library';
export const CACHE_SIZE_TREND_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-size', 'size-drift-observed', 'size-drift-sustained',
  'invalid-size-evidence', 'no-size-observation', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Size-trend library report must be an object');
  if (report.turbo !== 'cache-cleanup.size-trend') {
    throw new Error('Size-trend library requires a size-trend turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Size-trend library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Size-trend library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Size-trend library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Size-trend library persistenceThreshold must be from 1 to 64');
  }
  if (!Number.isFinite(report.minimumDeltaBytes) || report.minimumDeltaBytes < 0
    || report.minimumDeltaBytes > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Size-trend library minimumDeltaBytes must be a safe non-negative number');
  }
  for (const [field, label] of [
    ['cacheCount', 'cache count'], ['knownCount', 'known count'], ['invalidSizeCount', 'invalid-size count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) {
      throw new RangeError(`Size-trend library ${label} must be from 0 to 4096`);
    }
  }
  for (const [field, label] of [['totalBytes', 'totalBytes'], ['deltaBytes', 'deltaBytes']]) {
    if (!Number.isFinite(report[field]) || Math.abs(report[field]) > Number.MAX_SAFE_INTEGER) {
      throw new RangeError(`Size-trend library ${label} must be a safe number`);
    }
  }
  if (!Number.isInteger(report.comparisonCount) || report.comparisonCount < 0
    || report.comparisonCount > Math.max(0, report.sampleCount - 1)) {
    throw new RangeError('Size-trend library comparisonCount must fit inside the sample window');
  }
  for (const [field, label] of [
    ['changeCount', 'change count'], ['increaseCount', 'increase count'], ['decreaseCount', 'decrease count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.comparisonCount) {
      throw new RangeError(`Size-trend library ${label} must fit inside comparisonCount`);
    }
  }
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) {
    throw new TypeError('Size-trend library finalEnvironment must be normalized');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Size-trend library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Size-trend library reports must be an array');
  if (reports.length > 64) throw new RangeError('Size-trend library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-size-evidence')) return 'invalid-size-evidence';
  if (reports.some((report) => report.state === 'size-drift-sustained')) return 'size-drift-sustained';
  if (reports.some((report) => report.state === 'size-drift-observed')) return 'size-drift-observed';
  if (reports.every((report) => report.state === 'no-size-observation')) return 'no-size-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-size';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const latest = reports.at(-1);
  if (latest.knownCount === 0) return 0;
  return Math.round((latest.knownCount / Math.max(1, latest.cacheCount)) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-size-samples']);
  if (state === 'no-size-observation') return Object.freeze(['request-cache-size-observation']);
  if (state === 'invalid-size-evidence') return Object.freeze(['review-cache-size-evidence']);
  if (state === 'size-drift-sustained') return Object.freeze(['review-cache-size-trend-without-file-mutation']);
  if (state === 'size-drift-observed') return Object.freeze(['observe-cache-size-stability']);
  return Object.freeze(['preview-safe-cache-candidates']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-size-evidence') return 'size-evidence-review';
  if (state === 'size-drift-sustained') return 'size-trend-review';
  if (state === 'size-drift-observed') return 'size-trend-observation';
  if (state === 'no-size-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-size-evidence') return 750;
  if (state === 'size-drift-sustained') return 1000;
  if (state === 'size-drift-observed') return 1500;
  if (state === 'no-size-observation' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeCacheSizeTrendReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const latest = validated.at(-1);
  return Object.freeze({
    library: CACHE_SIZE_TREND_LIBRARY_ID,
    libraryVersion: CACHE_SIZE_TREND_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    cacheCount: latest?.cacheCount || 0,
    knownCount: latest?.knownCount || 0,
    invalidSizeCount: latest?.invalidSizeCount || 0,
    totalBytes: latest?.totalBytes || 0,
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0),
    increaseCount: validated.reduce((sum, report) => sum + report.increaseCount, 0),
    decreaseCount: validated.reduce((sum, report) => sum + report.decreaseCount, 0),
    deltaBytes: latest?.deltaBytes || 0,
    finalEnvironment: latest?.finalEnvironment || 'unknown',
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildCacheSizeTrendPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CACHE_SIZE_TREND_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0 ? 0
      : Math.round((validated.knownCount / Math.max(1, validated.cacheCount)) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Size-trend library clock must return a number');
  return timestamp;
}

export function buildCacheSizeTrendEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Size-trend library trigger is required');
  }
  return Object.freeze({
    library: CACHE_SIZE_TREND_LIBRARY_ID,
    libraryVersion: CACHE_SIZE_TREND_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCacheSizeTrendLibrary() {
  return Object.freeze({
    id: CACHE_SIZE_TREND_LIBRARY_ID,
    version: CACHE_SIZE_TREND_LIBRARY_VERSION,
    merge: mergeCacheSizeTrendReports,
    plan: buildCacheSizeTrendPlan,
    envelope: buildCacheSizeTrendEnvelope
  });
}
