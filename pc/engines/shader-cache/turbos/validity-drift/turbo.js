/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Shader-cache validity-drift turbo. It compares explicit validity evidence
 * without deleting caches, rebuilding files, changing drivers, or transport.
 */
export const SHADER_VALIDITY_DRIFT_TURBO_ID = 'shader-cache.validity-drift';
export const SHADER_VALIDITY_DRIFT_TURBO_VERSION = 1;
export const SHADER_VALIDITY_DRIFT_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function validityOf(value) { return value === true ? 'valid' : value === false ? 'stale' : 'unknown'; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Shader-cache validity-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Shader-cache validity-drift requires a system-facts snapshot');
  if (!Array.isArray(snapshot.shaderCaches)) throw new TypeError('Shader-cache validity-drift snapshot requires a shader-cache list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const rows = source.shaderCaches.filter(isRecord);
  const validity = rows.map((cache) => validityOf(cache.valid));
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    cacheCount: rows.length, validCount: validity.filter((item) => item === 'valid').length,
    staleCount: validity.filter((item) => item === 'stale').length, unknownCount: validity.filter((item) => item === 'unknown').length,
    signature: validity.join('|') });
}
function requireTrigger(trigger) {
  if (!SHADER_VALIDITY_DRIFT_TRIGGERS.includes(trigger)) throw new Error(`Unsupported shader-cache validity-drift trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Shader-cache validity-drift windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Shader-cache validity-drift minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Shader-cache validity-drift persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Shader-cache validity-drift clock must return a number'); return timestamp; }
function stateFor(sampleCount, minimumSamples, latest, changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (latest?.cacheCount === 0) return 'no-caches';
  if (latest?.unknownCount > 0) return 'observation-required';
  if (changeCount >= persistenceThreshold) return 'validity-drift-sustained';
  if (changeCount > 0) return 'validity-drift-observed';
  if (latest?.staleCount > 0) return 'stale-review';
  return 'stable-validity';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-validity-samples']);
  if (state === 'no-caches') return Object.freeze(['no-shader-cache-review']);
  if (state === 'observation-required') return Object.freeze(['request-shader-cache-validity-observation']);
  if (state === 'validity-drift-sustained') return Object.freeze(['review-validity-drift-without-cache-mutation']);
  if (state === 'validity-drift-observed') return Object.freeze(['observe-shader-cache-validity']);
  if (state === 'stale-review') return Object.freeze(['review-driver-documented-rebuild-path']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, latest, minimumSamples) {
  if (sampleCount === 0) return 0;
  const observation = latest.cacheCount === 0 ? 0.5 : latest.unknownCount === 0 ? 1 : 0.5;
  return Math.round(observation * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runShaderValidityDriftTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Shader-cache validity-drift samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const latest = evidence.at(-1);
  const changeCount = evidence.slice(1).filter((current, index) => current.signature !== evidence[index].signature).length;
  const state = stateFor(selected.length, requiredSamples, latest, changeCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: SHADER_VALIDITY_DRIFT_TURBO_ID, turboVersion: SHADER_VALIDITY_DRIFT_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, cacheCount: latest?.cacheCount || 0, validCount: latest?.validCount || 0,
    staleCount: latest?.staleCount || 0, unknownCount: latest?.unknownCount || 0, comparisonCount: Math.max(0, selected.length - 1),
    changeCount, finalEnvironment: latest?.environment || 'unknown', state, confidence: confidence(selected.length, latest || { cacheCount: 0, unknownCount: 0 }, requiredSamples),
    recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
