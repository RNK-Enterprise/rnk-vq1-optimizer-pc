/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Cache-cleanup library. It classifies bounded cache observations for review
 * and never reads paths, deletes files, or changes storage policy.
 */

export const CACHE_CLEANUP_LIBRARY_ID = 'cache-cleanup-library';
export const CACHE_CLEANUP_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function disposition(cache) {
  if (cache.userOwned === true) return 'user-owned';
  if (cache.safe !== true || cache.systemOwned !== true) return 'review';
  return 'safe-candidate';
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Cache-cleanup library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Cache-cleanup library requires normalized system facts');
  }
  if (!Array.isArray(facts.caches)) {
    throw new TypeError('Cache-cleanup library requires a cache list');
  }
  return facts;
}

function sum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0);
}

function stateFor(environment, count, reviewCount) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-caches';
  if (reviewCount > 0) return 'review-required';
  return 'preview-only';
}

function recommendations(environment, count, reviewCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-cache-cleanup-review']);
  if (reviewCount > 0) return Object.freeze(['review-cache-ownership']);
  return Object.freeze(['preview-safe-cache-candidates']);
}

function confidence(environment, count, completeCount) {
  let score = 0;
  if (environment !== 'unknown') score += 0.25;
  if (count > 0) score += 0.25;
  if (count > 0 && completeCount === count) score += 0.5;
  return Math.round(score * 10000) / 10000;
}

export function classifyCacheCleanup(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const caches = source.caches.filter(isRecord).map((cache) => ({
    name: text(cache.name),
    sizeBytes: nonNegative(cache.sizeBytes),
    disposition: disposition(cache)
  }));
  const safeCandidates = caches.filter((cache) => cache.disposition === 'safe-candidate');
  const reviewCount = caches.filter((cache) => cache.disposition !== 'safe-candidate').length;
  const completeCount = caches.filter((cache) => cache.name !== null && cache.sizeBytes !== null).length;
  return Object.freeze({
    library: CACHE_CLEANUP_LIBRARY_ID,
    libraryVersion: CACHE_CLEANUP_LIBRARY_VERSION,
    environment,
    cacheCount: caches.length,
    names: Object.freeze(caches.map((cache) => cache.name).filter(Boolean)),
    safeCandidateCount: safeCandidates.length,
    safeCandidateBytes: sum(safeCandidates, (cache) => cache.sizeBytes),
    reviewCount,
    completeCount,
    state: stateFor(environment, caches.length, reviewCount),
    confidence: confidence(environment, caches.length, completeCount),
    recommendations: recommendations(environment, caches.length, reviewCount)
  });
}

export function compareCacheCleanup(previous, current) {
  const before = classifyCacheCleanup(previous);
  const after = classifyCacheCleanup(current);
  const stateChanged = before.state !== after.state;
  const countChanged = before.cacheCount !== after.cacheCount;
  const candidateCountChanged = before.safeCandidateCount !== after.safeCandidateCount;
  const candidateBytesChanged = before.safeCandidateBytes !== after.safeCandidateBytes;
  const reviewChanged = before.reviewCount !== after.reviewCount;
  return Object.freeze({
    changed: stateChanged || countChanged || candidateCountChanged || candidateBytesChanged || reviewChanged,
    stateChanged,
    countChanged,
    candidateCountChanged,
    candidateBytesChanged,
    reviewChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Cache-cleanup library clock must return a number');
  return timestamp;
}

export function buildCacheCleanupEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Cache-cleanup library trigger is required');
  }
  return Object.freeze({
    library: CACHE_CLEANUP_LIBRARY_ID,
    libraryVersion: CACHE_CLEANUP_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyCacheCleanup(facts)
  });
}

export function createCacheCleanupLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Cache-cleanup library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: CACHE_CLEANUP_LIBRARY_ID,
    version: CACHE_CLEANUP_LIBRARY_VERSION,
    classify: classifyCacheCleanup,
    compare: compareCacheCleanup,
    envelope: (facts, envelopeOptions = {}) => buildCacheCleanupEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
