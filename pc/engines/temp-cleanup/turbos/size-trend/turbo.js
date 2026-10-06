/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Temp-cleanup size-trend turbo. It compares bounded safe-candidate sizes
 * without reading paths, deleting files, or changing storage policy.
 */
export const TEMP_SIZE_TREND_TURBO_ID = 'temp-cleanup.size-trend';
export const TEMP_SIZE_TREND_TURBO_VERSION = 1;
export const TEMP_SIZE_TREND_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function disposition(item) {
  if (item.userOwned === true) return 'user-owned';
  if (item.temporary !== true || item.systemOwned !== true) return 'review';
  return 'safe-candidate';
}
function sizeOf(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Temp-cleanup size-trend snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Temp-cleanup size-trend requires a system-facts snapshot');
  if (!Array.isArray(snapshot.temporaryFiles)) throw new TypeError('Temp-cleanup size-trend snapshot requires a temporary-file list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const rows = source.temporaryFiles.filter(isRecord);
  const safe = rows.filter((item) => disposition(item) === 'safe-candidate'); const sizes = safe.map((item) => sizeOf(item.sizeBytes));
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', fileCount: rows.length,
    candidateCount: safe.length, reviewCount: rows.length - safe.length, sizedCount: sizes.filter((size) => size !== null).length,
    unknownSizeCount: sizes.filter((size) => size === null).length, candidateBytes: sizes.filter((size) => size !== null).reduce((sum, size) => sum + size, 0) });
}
function requireTrigger(trigger) {
  if (!TEMP_SIZE_TREND_TRIGGERS.includes(trigger)) throw new Error(`Unsupported temp-cleanup size-trend trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Temp-cleanup size-trend windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Temp-cleanup size-trend minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Temp-cleanup size-trend persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Temp-cleanup size-trend clock must return a number'); return timestamp; }
function stateFor(sampleCount, minimumSamples, latest, growthCount, shrinkCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (latest?.fileCount === 0) return 'no-temp-review';
  if (latest?.reviewCount > 0) return 'review-required';
  if (latest?.unknownSizeCount > 0) return 'size-observation-required';
  if (growthCount >= persistenceThreshold) return 'size-growth-sustained';
  if (growthCount > 0) return 'size-growth-observed';
  if (shrinkCount > 0) return 'size-shrink-observed';
  return 'stable-size';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-temp-size-samples']);
  if (state === 'no-temp-review') return Object.freeze(['no-temp-cleanup-review']);
  if (state === 'review-required') return Object.freeze(['review-temp-file-ownership']);
  if (state === 'size-observation-required') return Object.freeze(['request-temp-size-observation']);
  if (state === 'size-growth-sustained') return Object.freeze(['review-temp-growth-without-file-mutation']);
  if (state === 'size-growth-observed') return Object.freeze(['observe-temp-size-stability']);
  if (state === 'size-shrink-observed') return Object.freeze(['record-temp-size-shrinkage']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, latest, minimumSamples) {
  if (sampleCount === 0) return 0;
  const completeness = latest.fileCount === 0 ? 0.25 : latest.reviewCount > 0 || latest.unknownSizeCount > 0 ? 0.5 : 1;
  return Math.round(completeness * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runTempSizeTrendTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Temp-cleanup size-trend samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const latest = evidence.at(-1);
  const deltas = evidence.slice(1).map((current, index) => current.candidateBytes - evidence[index].candidateBytes);
  const growthCount = deltas.filter((delta) => delta > 0).length; const shrinkCount = deltas.filter((delta) => delta < 0).length;
  const state = stateFor(selected.length, requiredSamples, latest, growthCount, shrinkCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: TEMP_SIZE_TREND_TURBO_ID, turboVersion: TEMP_SIZE_TREND_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, fileCount: latest?.fileCount || 0, candidateCount: latest?.candidateCount || 0,
    reviewCount: latest?.reviewCount || 0, sizedCount: latest?.sizedCount || 0, unknownSizeCount: latest?.unknownSizeCount || 0,
    comparisonCount: deltas.length, growthCount, shrinkCount, finalCandidateBytes: latest?.candidateBytes || 0,
    finalEnvironment: latest?.environment || 'unknown', state, confidence: confidence(selected.length, latest || { fileCount: 0, reviewCount: 0, unknownSizeCount: 0 }, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
