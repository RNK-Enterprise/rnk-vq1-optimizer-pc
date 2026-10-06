/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Temp-cleanup candidate-boundary turbo. It compares safe-preview evidence
 * without reading paths, deleting files, or changing storage policy.
 */
export const TEMP_CANDIDATE_BOUNDARY_TURBO_ID = 'temp-cleanup.candidate-boundary';
export const TEMP_CANDIDATE_BOUNDARY_TURBO_VERSION = 1;
export const TEMP_CANDIDATE_BOUNDARY_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('Temp-cleanup candidate-boundary snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Temp-cleanup candidate-boundary requires a system-facts snapshot');
  if (!Array.isArray(snapshot.temporaryFiles)) throw new TypeError('Temp-cleanup candidate-boundary snapshot requires a temporary-file list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const rows = source.temporaryFiles.filter(isRecord);
  const dispositions = rows.map(disposition); const safe = rows.filter((item, index) => dispositions[index] === 'safe-candidate');
  const signature = rows.map((item, index) => `${dispositions[index]}:${typeof item.name === 'string' ? item.name.trim() : 'unknown'}:${sizeOf(item.sizeBytes) ?? 'unknown'}`).join('|');
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', fileCount: rows.length,
    candidateCount: safe.length, reviewCount: rows.length - safe.length, completeCount: rows.filter((item) => typeof item.name === 'string' && item.name.trim() && sizeOf(item.sizeBytes) !== null).length,
    candidateBytes: safe.map((item) => sizeOf(item.sizeBytes)).filter((size) => size !== null).reduce((sum, size) => sum + size, 0), signature });
}
function requireTrigger(trigger) {
  if (!TEMP_CANDIDATE_BOUNDARY_TRIGGERS.includes(trigger)) throw new Error(`Unsupported temp-cleanup candidate-boundary trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Temp-cleanup candidate-boundary windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Temp-cleanup candidate-boundary minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Temp-cleanup candidate-boundary persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Temp-cleanup candidate-boundary clock must return a number'); return timestamp; }
function stateFor(sampleCount, minimumSamples, latest, changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (latest?.fileCount === 0) return 'no-temp-review';
  if (latest?.reviewCount > 0) return 'review-required';
  if (changeCount >= persistenceThreshold) return 'candidate-drift-sustained';
  if (changeCount > 0) return 'candidate-drift-observed';
  return 'preview-stable';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-temp-candidate-samples']);
  if (state === 'no-temp-review') return Object.freeze(['no-temp-cleanup-review']);
  if (state === 'review-required') return Object.freeze(['review-temp-file-ownership']);
  if (state === 'candidate-drift-sustained') return Object.freeze(['review-candidate-drift-without-file-mutation']);
  if (state === 'candidate-drift-observed') return Object.freeze(['observe-temp-candidate-stability']);
  return Object.freeze(['preview-safe-temp-candidates']);
}
function confidence(sampleCount, latest, minimumSamples) {
  if (sampleCount === 0) return 0;
  const completeness = latest.fileCount === 0 ? 0.25 : latest.completeCount === latest.fileCount ? 1 : 0.5;
  return Math.round(completeness * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runTempCandidateBoundaryTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Temp-cleanup candidate-boundary samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const latest = evidence.at(-1);
  const changeCount = evidence.slice(1).filter((current, index) => current.signature !== evidence[index].signature).length;
  const state = stateFor(selected.length, requiredSamples, latest, changeCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: TEMP_CANDIDATE_BOUNDARY_TURBO_ID, turboVersion: TEMP_CANDIDATE_BOUNDARY_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, fileCount: latest?.fileCount || 0, candidateCount: latest?.candidateCount || 0,
    reviewCount: latest?.reviewCount || 0, completeCount: latest?.completeCount || 0, candidateBytes: latest?.candidateBytes || 0,
    comparisonCount: Math.max(0, selected.length - 1), changeCount, finalEnvironment: latest?.environment || 'unknown', state,
    confidence: confidence(selected.length, latest || { fileCount: 0, completeCount: 0 }, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
