/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Shader-cache size-trend turbo. It compares explicit size evidence without
 * reading, deleting, rebuilding, or moving cache files.
 */
export const SHADER_SIZE_TREND_TURBO_ID = 'shader-cache.size-trend';
export const SHADER_SIZE_TREND_TURBO_VERSION = 1;
export const SHADER_SIZE_TREND_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function sizeOf(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Shader-cache size-trend snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Shader-cache size-trend requires a system-facts snapshot');
  if (!Array.isArray(snapshot.shaderCaches)) throw new TypeError('Shader-cache size-trend snapshot requires a shader-cache list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const sizes = source.shaderCaches.filter(isRecord).map((cache) => sizeOf(cache.sizeBytes));
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', cacheCount: sizes.length,
    sizedCount: sizes.filter((size) => size !== null).length, unknownSizeCount: sizes.filter((size) => size === null).length,
    totalBytes: sizes.filter((size) => size !== null).reduce((sum, size) => sum + size, 0) });
}
function requireTrigger(trigger) {
  if (!SHADER_SIZE_TREND_TRIGGERS.includes(trigger)) throw new Error(`Unsupported shader-cache size-trend trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Shader-cache size-trend windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Shader-cache size-trend minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Shader-cache size-trend persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Shader-cache size-trend clock must return a number'); return timestamp; }
function stateFor(sampleCount, minimumSamples, latest, growthCount, shrinkCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (latest?.cacheCount === 0) return 'no-caches';
  if (latest?.unknownSizeCount > 0) return 'size-observation-required';
  if (growthCount >= persistenceThreshold) return 'size-growth-sustained';
  if (growthCount > 0) return 'size-growth-observed';
  if (shrinkCount > 0) return 'size-shrink-observed';
  return 'stable-size';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-size-samples']);
  if (state === 'no-caches') return Object.freeze(['no-shader-cache-review']);
  if (state === 'size-observation-required') return Object.freeze(['request-shader-cache-size-observation']);
  if (state === 'size-growth-sustained') return Object.freeze(['review-cache-growth-without-file-mutation']);
  if (state === 'size-growth-observed') return Object.freeze(['observe-cache-size-stability']);
  if (state === 'size-shrink-observed') return Object.freeze(['record-cache-size-shrinkage']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, latest, minimumSamples) {
  if (sampleCount === 0) return 0;
  const observation = latest.cacheCount === 0 ? 0.5 : latest.unknownSizeCount === 0 ? 1 : 0.5;
  return Math.round(observation * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runShaderSizeTrendTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Shader-cache size-trend samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const latest = evidence.at(-1);
  const deltas = evidence.slice(1).map((current, index) => current.totalBytes - evidence[index].totalBytes);
  const growthCount = deltas.filter((delta) => delta > 0).length; const shrinkCount = deltas.filter((delta) => delta < 0).length;
  const state = stateFor(selected.length, requiredSamples, latest, growthCount, shrinkCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: SHADER_SIZE_TREND_TURBO_ID, turboVersion: SHADER_SIZE_TREND_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, cacheCount: latest?.cacheCount || 0, sizedCount: latest?.sizedCount || 0,
    unknownSizeCount: latest?.unknownSizeCount || 0, comparisonCount: deltas.length, growthCount, shrinkCount,
    finalTotalBytes: latest?.totalBytes || 0, finalEnvironment: latest?.environment || 'unknown', state,
    confidence: confidence(selected.length, latest || { cacheCount: 0, unknownSizeCount: 0 }, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
