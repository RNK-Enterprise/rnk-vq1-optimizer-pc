/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Shader-cache library. It classifies bounded cache observations for review
 * and never deletes caches, changes drivers, or rebuilds files.
 */

export const SHADER_CACHE_LIBRARY_ID = 'shader-cache-library';
export const SHADER_CACHE_LIBRARY_VERSION = 1;

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

function cacheState(value) {
  if (value === true) return 'valid';
  if (value === false) return 'stale';
  return 'unknown';
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Shader-cache library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Shader-cache library requires normalized system facts');
  }
  if (!Array.isArray(facts.shaderCaches)) {
    throw new TypeError('Shader-cache library requires a shader-cache list');
  }
  return facts;
}

function sum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0);
}

function stateFor(environment, count, unknownCount, staleCount) {
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

export function classifyShaderCache(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const caches = source.shaderCaches.filter(isRecord).map((cache) => ({
    name: text(cache.name),
    sizeBytes: nonNegative(cache.sizeBytes),
    state: cacheState(cache.valid),
    systemOwned: cache.systemOwned === true
  }));
  const validCount = caches.filter((cache) => cache.state === 'valid').length;
  const staleCount = caches.filter((cache) => cache.state === 'stale').length;
  const unknownCount = caches.filter((cache) => cache.state === 'unknown').length;
  const sizedCount = caches.filter((cache) => cache.sizeBytes !== null).length;
  return Object.freeze({
    library: SHADER_CACHE_LIBRARY_ID,
    libraryVersion: SHADER_CACHE_LIBRARY_VERSION,
    environment,
    shaderCacheCount: caches.length,
    names: Object.freeze(caches.map((cache) => cache.name).filter(Boolean)),
    validCount,
    staleCount,
    unknownCount,
    systemOwnedCount: caches.filter((cache) => cache.systemOwned).length,
    totalBytes: sum(caches, (cache) => cache.sizeBytes),
    state: stateFor(environment, caches.length, unknownCount, staleCount),
    confidence: confidence(environment, caches.length, unknownCount, sizedCount),
    recommendations: recommendations(environment, caches.length, unknownCount, staleCount)
  });
}

export function compareShaderCache(previous, current) {
  const before = classifyShaderCache(previous);
  const after = classifyShaderCache(current);
  const stateChanged = before.state !== after.state;
  const countChanged = before.shaderCacheCount !== after.shaderCacheCount;
  const validChanged = before.validCount !== after.validCount;
  const staleChanged = before.staleCount !== after.staleCount;
  const unknownChanged = before.unknownCount !== after.unknownCount;
  const bytesChanged = before.totalBytes !== after.totalBytes;
  const ownershipChanged = before.systemOwnedCount !== after.systemOwnedCount;
  return Object.freeze({
    changed: stateChanged || countChanged || validChanged || staleChanged
      || unknownChanged || bytesChanged || ownershipChanged,
    stateChanged,
    countChanged,
    validChanged,
    staleChanged,
    unknownChanged,
    bytesChanged,
    ownershipChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Shader-cache library clock must return a number');
  return timestamp;
}

export function buildShaderCacheEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Shader-cache library trigger is required');
  }
  return Object.freeze({
    library: SHADER_CACHE_LIBRARY_ID,
    libraryVersion: SHADER_CACHE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyShaderCache(facts)
  });
}

export function createShaderCacheLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Shader-cache library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: SHADER_CACHE_LIBRARY_ID,
    version: SHADER_CACHE_LIBRARY_VERSION,
    classify: classifyShaderCache,
    compare: compareShaderCache,
    envelope: (facts, envelopeOptions = {}) => buildShaderCacheEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
