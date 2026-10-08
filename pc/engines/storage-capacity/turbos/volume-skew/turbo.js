/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Volume-skew turbo. It observes bounded differences between volume
 * headroom ratios without moving files, balancing volumes, or writing.
 */

export const STORAGE_CAPACITY_VOLUME_SKEW_TURBO_ID = 'storage-capacity.volume-skew';
export const STORAGE_CAPACITY_VOLUME_SKEW_TURBO_VERSION = 1;
export const STORAGE_CAPACITY_VOLUME_SKEW_TRIGGERS = Object.freeze([
  'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function ratio(total, free) {
  if (total === null || total === 0 || free === null) return null;
  return Math.min(100, Math.max(0, (Math.min(total, free) / total) * 100));
}
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Volume-skew snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Volume-skew requires a system-facts snapshot');
  if (!Array.isArray(snapshot.storage)) throw new TypeError('Volume-skew snapshot requires a storage list');
  return snapshot;
}
function requireTrigger(trigger) {
  if (!STORAGE_CAPACITY_VOLUME_SKEW_TRIGGERS.includes(trigger)) throw new Error(`Unsupported volume-skew trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) throw new RangeError('Volume-skew windowSize must be an integer from 1 to 64');
  return windowSize;
}
function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) throw new RangeError('Volume-skew minimumSamples must fit inside the window');
  return minimumSamples;
}
function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) throw new RangeError(`Volume-skew ${name} must be an integer from 1 to 64`);
  return value;
}
function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('Volume-skew skewThreshold must be between 0 and 100');
  return value;
}
function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Volume-skew clock must return a number');
  return timestamp;
}
function environmentKnown(snapshot) { return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown'; }
function aggregate(snapshot, skewThreshold) {
  const source = requireSnapshot(snapshot);
  const rows = source.storage.filter(isRecord).map((item) => {
    const total = nonNegative(item.totalBytes);
    const free = total === null ? nonNegative(item.freeBytes) : Math.min(total, nonNegative(item.freeBytes));
    return ratio(total, free);
  });
  if (!environmentKnown(source)) return Object.freeze({ state: 'incomplete', storageCount: rows.length, skewPercent: null, skewed: false });
  if (rows.length === 0) return Object.freeze({ state: 'no-storage', storageCount: 0, skewPercent: null, skewed: false });
  if (rows.some((value) => value === null)) return Object.freeze({ state: 'incomplete', storageCount: rows.length, skewPercent: null, skewed: false });
  const skewPercent = rows.length > 1 ? Math.max(...rows) - Math.min(...rows) : 0;
  return Object.freeze({ state: 'observed', storageCount: rows.length, skewPercent, skewed: skewPercent >= skewThreshold });
}
function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, skewSampleCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-storage')) return 'no-storage';
  if (incompleteCount > 0) return 'incomplete-skew-evidence';
  if (skewSampleCount >= persistenceThreshold) return 'volume-skew-sustained';
  if (skewSampleCount > 0) return 'volume-skew-observed';
  return 'balanced-volumes';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-volume-samples']);
  if (state === 'no-storage') return Object.freeze(['no-storage-skew-review']);
  if (state === 'incomplete-skew-evidence') return Object.freeze(['request-volume-observation']);
  if (state === 'volume-skew-sustained') return Object.freeze(['review-volume-headroom', 'hold-automatic-rebalancing']);
  if (state === 'volume-skew-observed') return Object.freeze(['observe-volume-headroom']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runStorageCapacityVolumeSkewTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, skewThreshold = 30,
  persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Volume-skew samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredThreshold = requireThreshold(skewThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => aggregate(sample, requiredThreshold));
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noStorageCount = evidence.filter((item) => item.state === 'no-storage').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const skewSampleCount = evidence.filter((item) => item.state === 'observed' && item.skewed).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, skewSampleCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ storageCount: 0, skewPercent: null });
  return Object.freeze({ protocolVersion: 1, turbo: STORAGE_CAPACITY_VOLUME_SKEW_TURBO_ID,
    turboVersion: STORAGE_CAPACITY_VOLUME_SKEW_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length, minimumSamples: requiredSamples, skewThreshold: requiredThreshold,
    persistenceThreshold: requiredPersistence, storageCount: latest.storageCount, skewPercent: latest.skewPercent,
    observedCount, incompleteCount, noStorageCount, skewSampleCount, state,
    confidence: confidence(selected.length, observedCount, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
