/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Shader-cache rebuild-evidence turbo. It reviews explicit stale-cache
 * evidence and never starts a rebuild or changes a cache.
 */
export const SHADER_REBUILD_EVIDENCE_TURBO_ID = 'shader-cache.rebuild-evidence';
export const SHADER_REBUILD_EVIDENCE_TURBO_VERSION = 1;
export const SHADER_REBUILD_EVIDENCE_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function validityOf(value) { return value === true ? 'valid' : value === false ? 'stale' : 'unknown'; }
function rebuildEvidenceOf(value) { return typeof value === 'boolean' ? value : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Shader-cache rebuild-evidence snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Shader-cache rebuild-evidence requires a system-facts snapshot');
  if (!Array.isArray(snapshot.shaderCaches)) throw new TypeError('Shader-cache rebuild-evidence snapshot requires a shader-cache list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const rows = source.shaderCaches.filter(isRecord);
  const details = rows.map((cache) => ({ validity: validityOf(cache.valid), documented: rebuildEvidenceOf(cache.rebuildDocumented) }));
  const stale = details.filter((item) => item.validity === 'stale');
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', cacheCount: rows.length,
    staleCount: stale.length, documentedCount: stale.filter((item) => item.documented === true).length,
    undocumentedCount: stale.filter((item) => item.documented === false).length,
    unknownEvidenceCount: details.filter((item) => item.validity === 'unknown' || (item.validity === 'stale' && item.documented === null)).length,
    signature: details.map((item) => `${item.validity}:${item.documented}`).join('|') });
}
function requireTrigger(trigger) {
  if (!SHADER_REBUILD_EVIDENCE_TRIGGERS.includes(trigger)) throw new Error(`Unsupported shader-cache rebuild-evidence trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Shader-cache rebuild-evidence windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Shader-cache rebuild-evidence minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Shader-cache rebuild-evidence persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Shader-cache rebuild-evidence clock must return a number'); return timestamp; }
function stateFor(sampleCount, minimumSamples, latest, changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (latest?.cacheCount === 0) return 'no-caches';
  if (latest?.unknownEvidenceCount > 0) return 'observation-required';
  if (latest?.staleCount === 0) return 'no-stale-caches';
  if (changeCount >= persistenceThreshold) return 'rebuild-evidence-drift-sustained';
  if (changeCount > 0) return 'rebuild-evidence-drift-observed';
  if (latest?.undocumentedCount > 0) return 'rebuild-evidence-required';
  return 'rebuild-evidence-observed';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-rebuild-evidence-samples']);
  if (state === 'no-caches') return Object.freeze(['no-shader-cache-review']);
  if (state === 'observation-required') return Object.freeze(['request-complete-rebuild-evidence']);
  if (state === 'no-stale-caches') return Object.freeze(['no-rebuild-review']);
  if (state === 'rebuild-evidence-required') return Object.freeze(['request-driver-documented-rebuild-path']);
  if (state === 'rebuild-evidence-drift-sustained') return Object.freeze(['review-rebuild-evidence-drift-without-mutation']);
  if (state === 'rebuild-evidence-drift-observed') return Object.freeze(['observe-rebuild-evidence-stability']);
  return Object.freeze(['review-documented-rebuild-path-without-execution']);
}
function confidence(sampleCount, latest, minimumSamples) {
  if (sampleCount === 0) return 0;
  const observation = latest.cacheCount === 0 ? 0.5 : latest.unknownEvidenceCount === 0 ? 1 : 0.5;
  return Math.round(observation * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runShaderRebuildEvidenceTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Shader-cache rebuild-evidence samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const latest = evidence.at(-1);
  const changeCount = evidence.slice(1).filter((current, index) => current.signature !== evidence[index].signature).length;
  const state = stateFor(selected.length, requiredSamples, latest, changeCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: SHADER_REBUILD_EVIDENCE_TURBO_ID, turboVersion: SHADER_REBUILD_EVIDENCE_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, cacheCount: latest?.cacheCount || 0, staleCount: latest?.staleCount || 0,
    documentedCount: latest?.documentedCount || 0, undocumentedCount: latest?.undocumentedCount || 0,
    unknownEvidenceCount: latest?.unknownEvidenceCount || 0, comparisonCount: Math.max(0, selected.length - 1), changeCount,
    finalEnvironment: latest?.environment || 'unknown', state, confidence: confidence(selected.length, latest || { cacheCount: 0, unknownEvidenceCount: 0 }, requiredSamples),
    recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
