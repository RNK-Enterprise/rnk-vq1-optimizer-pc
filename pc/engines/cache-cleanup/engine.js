/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Cache-cleanup engine. It previews explicitly system-owned cache candidates
 * without reading paths, deleting files, or changing transport state.
 */

export const CACHE_CLEANUP_ENGINE_ID = 'cache-cleanup';
export const CACHE_CLEANUP_ENGINE_VERSION = 1;
export const CACHE_CLEANUP_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

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
  if (!isRecord(facts)) throw new TypeError('Cache-cleanup facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Cache-cleanup requires system-facts facts');
  if (!Array.isArray(facts.caches)) throw new TypeError('Cache-cleanup facts require a cache list');
  return facts;
}

function requireTrigger(trigger) {
  if (!CACHE_CLEANUP_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported cache-cleanup trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Cache-cleanup clock must return a number');
  return timestamp;
}

function operatingState(environment, count, reviewCount) {
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

export function runCacheCleanupEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const caches = source.caches.filter(isRecord).map((cache) => ({
    name: text(cache.name),
    sizeBytes: nonNegative(cache.sizeBytes),
    disposition: disposition(cache)
  }));
  const safeCandidates = caches.filter((cache) => cache.disposition === 'safe-candidate');
  const reviewCount = caches.filter((cache) => cache.disposition !== 'safe-candidate').length;
  const completeCount = caches.filter((cache) => cache.name !== null && cache.sizeBytes !== null).length;
  const safeBytes = safeCandidates
    .map((cache) => cache.sizeBytes)
    .filter((size) => size !== null)
    .reduce((total, size) => total + size, 0);
  return Object.freeze({
    protocolVersion: 1,
    engine: CACHE_CLEANUP_ENGINE_ID,
    engineVersion: CACHE_CLEANUP_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    cacheCount: caches.length,
    names: Object.freeze(caches.map((cache) => cache.name).filter(Boolean)),
    safeCandidateCount: safeCandidates.length,
    safeCandidateBytes: safeBytes,
    reviewCount,
    completeCount,
    state: operatingState(environment, caches.length, reviewCount),
    confidence: confidence(environment, caches.length, completeCount),
    recommendations: recommendations(environment, caches.length, reviewCount),
    actions: EMPTY_ARRAY
  });
}
