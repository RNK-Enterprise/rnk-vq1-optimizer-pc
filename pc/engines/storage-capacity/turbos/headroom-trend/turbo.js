/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Headroom-trend turbo. It observes bounded adjacent free-space movement
 * without deleting files, moving paths, remounting volumes, or writing.
 */

export const STORAGE_CAPACITY_HEADROOM_TREND_TURBO_ID = 'storage-capacity.headroom-trend';
export const STORAGE_CAPACITY_HEADROOM_TREND_TURBO_VERSION = 1;
export const STORAGE_CAPACITY_HEADROOM_TREND_TRIGGERS = Object.freeze([
  'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function freePercent(total, free) { if (total === null || total === 0 || free === null) return null; return Math.min(100, Math.max(0, (Math.min(total, free) / total) * 100)); }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Headroom-trend snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Headroom-trend requires a system-facts snapshot');
  if (!Array.isArray(snapshot.storage)) throw new TypeError('Headroom-trend snapshot requires a storage list');
  return snapshot;
}
function requireTrigger(trigger) { if (!STORAGE_CAPACITY_HEADROOM_TREND_TRIGGERS.includes(trigger)) throw new Error(`Unsupported headroom-trend trigger: ${trigger || 'unknown'}`); return trigger; }
function requireWindowSize(windowSize) { if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) throw new RangeError('Headroom-trend windowSize must be an integer from 1 to 64'); return windowSize; }
function requireMinimumSamples(minimumSamples, windowSize) { if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) throw new RangeError('Headroom-trend minimumSamples must fit inside the window'); return minimumSamples; }
function requireCount(name, value) { if (!Number.isInteger(value) || value < 1 || value > 64) throw new RangeError(`Headroom-trend ${name} must be an integer from 1 to 64`); return value; }
function requireThreshold(value) { if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('Headroom-trend declineThreshold must be between 0 and 100'); return value; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Headroom-trend clock must return a number'); return timestamp; }
function environmentKnown(snapshot) { return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown'; }
function aggregate(snapshot) {
  const source = requireSnapshot(snapshot); const rows = source.storage.filter(isRecord).map((item) => { const total = nonNegative(item.totalBytes); const free = total === null ? nonNegative(item.freeBytes) : Math.min(total, nonNegative(item.freeBytes)); return freePercent(total, free); });
  if (!environmentKnown(source)) return Object.freeze({ state: 'incomplete', storageCount: rows.length, minimumFreePercent: null });
  if (rows.length === 0) return Object.freeze({ state: 'no-storage', storageCount: 0, minimumFreePercent: null });
  if (rows.some((value) => value === null)) return Object.freeze({ state: 'incomplete', storageCount: rows.length, minimumFreePercent: null });
  return Object.freeze({ state: 'observed', storageCount: rows.length, minimumFreePercent: Math.min(...rows) });
}
function declineSamples(evidence, declineThreshold) {
  let count = 0;
  for (let index = 1; index < evidence.length; index += 1) {
    const before = evidence[index - 1]; const current = evidence[index];
    if (before.state === 'observed' && current.state === 'observed' && before.minimumFreePercent - current.minimumFreePercent >= declineThreshold) count += 1;
  }
  return count;
}
function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, declineSampleCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-storage')) return 'no-storage';
  if (incompleteCount > 0) return 'incomplete-trend-evidence';
  if (declineSampleCount >= persistenceThreshold) return 'headroom-decline-sustained';
  if (declineSampleCount > 0) return 'headroom-decline-observed';
  return 'stable-headroom-trend';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-trend-samples']);
  if (state === 'no-storage') return Object.freeze(['no-storage-trend-review']);
  if (state === 'incomplete-trend-evidence') return Object.freeze(['request-headroom-observation']);
  if (state === 'headroom-decline-sustained') return Object.freeze(['review-capacity-trend', 'hold-automatic-cleanup']);
  if (state === 'headroom-decline-observed') return Object.freeze(['observe-next-headroom-trend']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) { if (sampleCount === 0) return 0; return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000; }
export function runStorageCapacityHeadroomTrendTurbo(samples = [], { trigger, windowSize = 16, minimumSamples = 2, declineThreshold = 5, persistenceThreshold = 2, now = Date.now } = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Headroom-trend samples must be an array');
  const boundedWindow = requireWindowSize(windowSize); const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow); const requiredThreshold = requireThreshold(declineThreshold); const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow); const timestamp = requireClock(now); const evidence = selected.map(aggregate);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length; const noStorageCount = evidence.filter((item) => item.state === 'no-storage').length; const observedCount = evidence.filter((item) => item.state === 'observed').length; const declineSampleCount = declineSamples(evidence, requiredThreshold);
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, declineSampleCount, requiredPersistence); const latest = evidence.at(-1) || Object.freeze({ storageCount: 0, minimumFreePercent: null });
  return Object.freeze({ protocolVersion: 1, turbo: STORAGE_CAPACITY_HEADROOM_TREND_TURBO_ID, turboVersion: STORAGE_CAPACITY_HEADROOM_TREND_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples, declineThreshold: requiredThreshold, persistenceThreshold: requiredPersistence, storageCount: latest.storageCount, minimumFreePercent: latest.minimumFreePercent, observedCount, incompleteCount, noStorageCount, declineSampleCount, state, confidence: confidence(selected.length, observedCount, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
