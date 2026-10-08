/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Shader-cache ownership-boundary turbo. It preserves explicit ownership and
 * never deletes, rebuilds, or moves a cache.
 */
export const SHADER_OWNERSHIP_BOUNDARY_TURBO_ID = 'shader-cache.ownership-boundary';
export const SHADER_OWNERSHIP_BOUNDARY_TURBO_VERSION = 1;
export const SHADER_OWNERSHIP_BOUNDARY_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function ownershipOf(cache) {
  if (cache.userOwned === true) return 'user-owned';
  if (cache.systemOwned === true) return 'system-owned';
  return 'unknown';
}
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Shader-cache ownership-boundary snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Shader-cache ownership-boundary requires a system-facts snapshot');
  if (!Array.isArray(snapshot.shaderCaches)) throw new TypeError('Shader-cache ownership-boundary snapshot requires a shader-cache list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const ownership = source.shaderCaches.filter(isRecord).map(ownershipOf);
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', cacheCount: ownership.length,
    systemOwnedCount: ownership.filter((item) => item === 'system-owned').length, userOwnedCount: ownership.filter((item) => item === 'user-owned').length,
    unknownOwnershipCount: ownership.filter((item) => item === 'unknown').length, signature: ownership.join('|') });
}
function requireTrigger(trigger) {
  if (!SHADER_OWNERSHIP_BOUNDARY_TRIGGERS.includes(trigger)) throw new Error(`Unsupported shader-cache ownership-boundary trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Shader-cache ownership-boundary windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Shader-cache ownership-boundary minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Shader-cache ownership-boundary persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Shader-cache ownership-boundary clock must return a number'); return timestamp; }
function stateFor(sampleCount, minimumSamples, latest, changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (latest?.cacheCount === 0) return 'no-caches';
  if (latest?.userOwnedCount > 0) return 'user-owned-review';
  if (latest?.unknownOwnershipCount > 0) return 'ownership-required';
  if (changeCount >= persistenceThreshold) return 'ownership-drift-sustained';
  if (changeCount > 0) return 'ownership-drift-observed';
  return 'stable-ownership';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-ownership-samples']);
  if (state === 'no-caches') return Object.freeze(['no-shader-cache-review']);
  if (state === 'user-owned-review') return Object.freeze(['preserve-user-owned-cache-boundary']);
  if (state === 'ownership-required') return Object.freeze(['request-shader-cache-ownership']);
  if (state === 'ownership-drift-sustained') return Object.freeze(['review-cache-ownership-drift-without-mutation']);
  if (state === 'ownership-drift-observed') return Object.freeze(['observe-cache-ownership-stability']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, latest, minimumSamples) {
  if (sampleCount === 0) return 0;
  const observation = latest.cacheCount === 0 ? 0.5 : latest.unknownOwnershipCount === 0 ? 1 : 0.5;
  return Math.round(observation * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runShaderOwnershipBoundaryTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Shader-cache ownership-boundary samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const latest = evidence.at(-1);
  const changeCount = evidence.slice(1).filter((current, index) => current.signature !== evidence[index].signature).length;
  const state = stateFor(selected.length, requiredSamples, latest, changeCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: SHADER_OWNERSHIP_BOUNDARY_TURBO_ID, turboVersion: SHADER_OWNERSHIP_BOUNDARY_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, cacheCount: latest?.cacheCount || 0, systemOwnedCount: latest?.systemOwnedCount || 0,
    userOwnedCount: latest?.userOwnedCount || 0, unknownOwnershipCount: latest?.unknownOwnershipCount || 0,
    comparisonCount: Math.max(0, selected.length - 1), changeCount, finalEnvironment: latest?.environment || 'unknown', state,
    confidence: confidence(selected.length, latest || { cacheCount: 0, unknownOwnershipCount: 0 }, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
