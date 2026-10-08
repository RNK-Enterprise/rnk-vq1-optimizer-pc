/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Temp-cleanup preview-safety turbo. It validates explicit evidence for a
 * preview without reading paths, deleting files, or changing storage policy.
 */
export const TEMP_PREVIEW_SAFETY_TURBO_ID = 'temp-cleanup.preview-safety';
export const TEMP_PREVIEW_SAFETY_TURBO_VERSION = 1;
export const TEMP_PREVIEW_SAFETY_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function sizeOf(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function nameOf(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Temp-cleanup preview-safety snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Temp-cleanup preview-safety requires a system-facts snapshot');
  if (!Array.isArray(snapshot.temporaryFiles)) throw new TypeError('Temp-cleanup preview-safety snapshot requires a temporary-file list');
  return snapshot;
}
function disposition(item) {
  if (item.userOwned === true) return 'user-owned';
  if (item.temporary !== true) return 'not-temporary';
  if (item.systemOwned !== true) return 'ownership-required';
  if (nameOf(item.name) === null) return 'identity-required';
  if (sizeOf(item.sizeBytes) === null) return 'size-required';
  return 'preview-safe';
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.temporaryFiles.filter(isRecord);
  const dispositions = rows.map(disposition);
  const safe = rows.filter((item, index) => dispositions[index] === 'preview-safe');
  const signature = rows.map((item, index) => `${dispositions[index]}:${nameOf(item.name) || 'unknown'}:${sizeOf(item.sizeBytes) ?? 'unknown'}`).join('|');
  return Object.freeze({
    environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    fileCount: rows.length,
    safeCount: safe.length,
    reviewCount: rows.length - safe.length,
    userOwnedCount: dispositions.filter((item) => item === 'user-owned').length,
    incompleteCount: dispositions.filter((item) => item !== 'preview-safe' && item !== 'user-owned').length,
    candidateBytes: safe.map((item) => sizeOf(item.sizeBytes)).reduce((sum, size) => sum + size, 0),
    signature
  });
}
function requireTrigger(trigger) {
  if (!TEMP_PREVIEW_SAFETY_TRIGGERS.includes(trigger)) throw new Error(`Unsupported temp-cleanup preview-safety trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Temp-cleanup preview-safety windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Temp-cleanup preview-safety minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Temp-cleanup preview-safety persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Temp-cleanup preview-safety clock must return a number');
  return timestamp;
}
function stateFor(sampleCount, minimumSamples, latest, changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (latest?.fileCount === 0) return 'no-temp-review';
  if (latest?.userOwnedCount > 0) return 'user-owned-review';
  if (latest?.reviewCount > 0) return 'safety-evidence-required';
  if (changeCount >= persistenceThreshold) return 'preview-drift-sustained';
  if (changeCount > 0) return 'preview-drift-observed';
  return 'preview-safe-stable';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-temp-preview-evidence']);
  if (state === 'no-temp-review') return Object.freeze(['no-temp-cleanup-review']);
  if (state === 'user-owned-review') return Object.freeze(['preserve-user-owned-temp-boundary']);
  if (state === 'safety-evidence-required') return Object.freeze(['complete-temp-preview-evidence']);
  if (state === 'preview-drift-sustained') return Object.freeze(['review-temp-preview-drift-without-mutation']);
  if (state === 'preview-drift-observed') return Object.freeze(['observe-temp-preview-stability']);
  return Object.freeze(['preview-safe-temp-candidates']);
}
function confidence(sampleCount, latest, minimumSamples) {
  if (sampleCount === 0) return 0;
  const quality = latest.fileCount === 0 ? 0.25 : latest.reviewCount === 0 ? 1 : 0.5;
  return Math.round(quality * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}

export function runTempPreviewSafetyTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Temp-cleanup preview-safety samples must be an array');
  const boundedWindow = requireWindow(windowSize);
  const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const latest = evidence.at(-1);
  const changeCount = evidence.slice(1).filter((current, index) => current.signature !== evidence[index].signature).length;
  const state = stateFor(selected.length, requiredSamples, latest, changeCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1, turbo: TEMP_PREVIEW_SAFETY_TURBO_ID, turboVersion: TEMP_PREVIEW_SAFETY_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length,
    minimumSamples: requiredSamples, persistenceThreshold: requiredPersistence,
    fileCount: latest?.fileCount || 0, safeCount: latest?.safeCount || 0, reviewCount: latest?.reviewCount || 0,
    userOwnedCount: latest?.userOwnedCount || 0, incompleteCount: latest?.incompleteCount || 0,
    candidateBytes: latest?.candidateBytes || 0, comparisonCount: Math.max(0, selected.length - 1),
    changeCount, finalEnvironment: latest?.environment || 'unknown', state,
    confidence: confidence(selected.length, latest || { fileCount: 0, reviewCount: 0 }, requiredSamples),
    recommendations: recommendations(state), actions: EMPTY_ARRAY
  });
}
