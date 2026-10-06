/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Temp-cleanup ownership-drift turbo. It compares explicit ownership without
 * reading paths, deleting files, or changing storage policy.
 */
export const TEMP_OWNERSHIP_DRIFT_TURBO_ID = 'temp-cleanup.ownership-drift';
export const TEMP_OWNERSHIP_DRIFT_TURBO_VERSION = 1;
export const TEMP_OWNERSHIP_DRIFT_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function ownershipOf(item) {
  if (item.userOwned === true) return 'user-owned';
  if (item.systemOwned === true) return 'system-owned';
  return 'unknown';
}
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Temp-cleanup ownership-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Temp-cleanup ownership-drift requires a system-facts snapshot');
  if (!Array.isArray(snapshot.temporaryFiles)) throw new TypeError('Temp-cleanup ownership-drift snapshot requires a temporary-file list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const ownership = source.temporaryFiles.filter(isRecord).map(ownershipOf);
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', fileCount: ownership.length,
    systemOwnedCount: ownership.filter((item) => item === 'system-owned').length, userOwnedCount: ownership.filter((item) => item === 'user-owned').length,
    unknownOwnershipCount: ownership.filter((item) => item === 'unknown').length, signature: ownership.join('|') });
}
function requireTrigger(trigger) {
  if (!TEMP_OWNERSHIP_DRIFT_TRIGGERS.includes(trigger)) throw new Error(`Unsupported temp-cleanup ownership-drift trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Temp-cleanup ownership-drift windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Temp-cleanup ownership-drift minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Temp-cleanup ownership-drift persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Temp-cleanup ownership-drift clock must return a number'); return timestamp; }
function stateFor(sampleCount, minimumSamples, latest, changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (latest?.fileCount === 0) return 'no-temp-review';
  if (latest?.userOwnedCount > 0) return 'user-owned-review';
  if (latest?.unknownOwnershipCount > 0) return 'ownership-required';
  if (changeCount >= persistenceThreshold) return 'ownership-drift-sustained';
  if (changeCount > 0) return 'ownership-drift-observed';
  return 'stable-ownership';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-temp-ownership-samples']);
  if (state === 'no-temp-review') return Object.freeze(['no-temp-cleanup-review']);
  if (state === 'user-owned-review') return Object.freeze(['preserve-user-owned-temp-boundary']);
  if (state === 'ownership-required') return Object.freeze(['request-temp-file-ownership']);
  if (state === 'ownership-drift-sustained') return Object.freeze(['review-temp-ownership-drift-without-mutation']);
  if (state === 'ownership-drift-observed') return Object.freeze(['observe-temp-ownership-stability']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, latest, minimumSamples) {
  if (sampleCount === 0) return 0;
  const observation = latest.fileCount === 0 ? 0.25 : latest.unknownOwnershipCount === 0 ? 1 : 0.5;
  return Math.round(observation * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runTempOwnershipDriftTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Temp-cleanup ownership-drift samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const latest = evidence.at(-1);
  const changeCount = evidence.slice(1).filter((current, index) => current.signature !== evidence[index].signature).length;
  const state = stateFor(selected.length, requiredSamples, latest, changeCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: TEMP_OWNERSHIP_DRIFT_TURBO_ID, turboVersion: TEMP_OWNERSHIP_DRIFT_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, fileCount: latest?.fileCount || 0, systemOwnedCount: latest?.systemOwnedCount || 0,
    userOwnedCount: latest?.userOwnedCount || 0, unknownOwnershipCount: latest?.unknownOwnershipCount || 0,
    comparisonCount: Math.max(0, selected.length - 1), changeCount, finalEnvironment: latest?.environment || 'unknown', state,
    confidence: confidence(selected.length, latest || { fileCount: 0, unknownOwnershipCount: 0 }, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
