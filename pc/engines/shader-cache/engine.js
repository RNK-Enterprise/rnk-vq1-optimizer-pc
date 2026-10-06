/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Shader-cache engine. It reports bounded shader-cache validity evidence
 * without deleting caches, changing drivers, or modifying files.
 */

export const SHADER_CACHE_ENGINE_ID = 'shader-cache';
export const SHADER_CACHE_ENGINE_VERSION = 1;
export const SHADER_CACHE_TRIGGERS = Object.freeze([
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

function cacheState(value) {
  if (value === true) return 'valid';
  if (value === false) return 'stale';
  return 'unknown';
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Shader-cache facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Shader-cache requires system-facts facts');
  if (!Array.isArray(facts.shaderCaches)) throw new TypeError('Shader-cache facts require a shader-cache list');
  return facts;
}

function requireTrigger(trigger) {
  if (!SHADER_CACHE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported shader-cache trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Shader-cache clock must return a number');
  return timestamp;
}

function operatingState(environment, count, unknownCount, staleCount) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-shader-caches';
  if (unknownCount > 0) return 'observation-required';
  if (staleCount > 0) return 'rebuild-review';
  return 'observe';
}

function recommendations(environment, count, unknownCount, staleCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-shader-cache-review']);
  if (unknownCount > 0) return Object.freeze(['request-shader-cache-observation']);
  if (staleCount > 0) return Object.freeze(['review-driver-documented-rebuild-path']);
  return Object.freeze(['no-change']);
}

function confidence(environment, count, unknownCount, sizedCount) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (count > 0) score += 0.2;
  if (count > 0 && unknownCount === 0) score += 0.3;
  if (count > 0 && sizedCount === count) score += 0.3;
  return Math.round(score * 10000) / 10000;
}

export function runShaderCacheEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const caches = source.shaderCaches.filter(isRecord).map((cache) => ({
    name: text(cache.name),
    sizeBytes: nonNegative(cache.sizeBytes),
    state: cacheState(cache.valid),
    systemOwned: cache.systemOwned === true
  }));
  const unknownCount = caches.filter((cache) => cache.state === 'unknown').length;
  const staleCount = caches.filter((cache) => cache.state === 'stale').length;
  const sizedCount = caches.filter((cache) => cache.sizeBytes !== null).length;
  const totalBytes = caches
    .map((cache) => cache.sizeBytes)
    .filter((size) => size !== null)
    .reduce((total, size) => total + size, 0);
  return Object.freeze({
    protocolVersion: 1,
    engine: SHADER_CACHE_ENGINE_ID,
    engineVersion: SHADER_CACHE_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    shaderCacheCount: caches.length,
    names: Object.freeze(caches.map((cache) => cache.name).filter(Boolean)),
    validCount: caches.filter((cache) => cache.state === 'valid').length,
    staleCount,
    unknownCount,
    systemOwnedCount: caches.filter((cache) => cache.systemOwned).length,
    totalBytes,
    state: operatingState(environment, caches.length, unknownCount, staleCount),
    confidence: confidence(environment, caches.length, unknownCount, sizedCount),
    recommendations: recommendations(environment, caches.length, unknownCount, staleCount),
    actions: EMPTY_ARRAY
  });
}
