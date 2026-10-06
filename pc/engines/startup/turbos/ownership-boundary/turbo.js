/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Startup ownership-boundary turbo. It tracks explicit ownership evidence
 * without disabling entries, changing boot configuration, or editing files.
 */
export const STARTUP_OWNERSHIP_BOUNDARY_TURBO_ID = 'startup.ownership-boundary';
export const STARTUP_OWNERSHIP_BOUNDARY_TURBO_VERSION = 1;
export const STARTUP_OWNERSHIP_BOUNDARY_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function ownershipOf(entry) {
  if (entry.userOwned === true) return 'user-owned';
  if (entry.systemOwned === true) return 'system-owned';
  return 'unknown';
}
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Startup ownership-boundary snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Startup ownership-boundary requires a system-facts snapshot');
  if (!Array.isArray(snapshot.startup)) throw new TypeError('Startup ownership-boundary snapshot requires a startup list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const entries = source.startup.filter(isRecord);
  const ownership = entries.map(ownershipOf); const signature = entries.map((entry, index) => `${text(entry.name) || 'unknown'}:${ownership[index]}:${entry.enabled === true}`).join('|');
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', entryCount: entries.length,
    userOwnedCount: ownership.filter((item) => item === 'user-owned').length, systemOwnedCount: ownership.filter((item) => item === 'system-owned').length,
    unknownOwnershipCount: ownership.filter((item) => item === 'unknown').length, userOwnedEnabledCount: entries.filter((entry, index) => ownership[index] === 'user-owned' && entry.enabled === true).length, signature });
}
function requireTrigger(trigger) {
  if (!STARTUP_OWNERSHIP_BOUNDARY_TRIGGERS.includes(trigger)) throw new Error(`Unsupported startup ownership-boundary trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Startup ownership-boundary windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Startup ownership-boundary minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Startup ownership-boundary persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Startup ownership-boundary clock must return a number'); return timestamp; }
function stateFor(sampleCount, minimumSamples, latest, changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (latest?.entryCount === 0) return 'no-startup-items';
  if (latest?.unknownOwnershipCount > 0) return 'ownership-required';
  if (latest?.userOwnedEnabledCount > 0) return 'user-owned-review';
  if (changeCount >= persistenceThreshold) return 'ownership-drift-sustained';
  if (changeCount > 0) return 'ownership-drift-observed';
  return 'stable-ownership';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-startup-ownership-samples']);
  if (state === 'no-startup-items') return Object.freeze(['no-startup-review']);
  if (state === 'ownership-required') return Object.freeze(['request-startup-ownership']);
  if (state === 'user-owned-review') return Object.freeze(['preserve-user-owned-startup-boundary']);
  if (state === 'ownership-drift-sustained') return Object.freeze(['review-startup-ownership-drift-without-mutation']);
  if (state === 'ownership-drift-observed') return Object.freeze(['observe-startup-ownership-stability']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, latest, minimumSamples) {
  if (sampleCount === 0) return 0;
  const quality = latest.entryCount === 0 ? 0.25 : latest.unknownOwnershipCount === 0 ? 1 : 0.5;
  return Math.round(quality * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runStartupOwnershipBoundaryTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Startup ownership-boundary samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const latest = evidence.at(-1);
  const changeCount = evidence.slice(1).filter((current, index) => current.signature !== evidence[index].signature).length;
  const state = stateFor(selected.length, requiredSamples, latest, changeCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: STARTUP_OWNERSHIP_BOUNDARY_TURBO_ID, turboVersion: STARTUP_OWNERSHIP_BOUNDARY_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, entryCount: latest?.entryCount || 0, userOwnedCount: latest?.userOwnedCount || 0,
    systemOwnedCount: latest?.systemOwnedCount || 0, unknownOwnershipCount: latest?.unknownOwnershipCount || 0,
    userOwnedEnabledCount: latest?.userOwnedEnabledCount || 0, comparisonCount: Math.max(0, selected.length - 1), changeCount,
    finalEnvironment: latest?.environment || 'unknown', state, confidence: confidence(selected.length, latest || { entryCount: 0, unknownOwnershipCount: 0 }, requiredSamples),
    recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
