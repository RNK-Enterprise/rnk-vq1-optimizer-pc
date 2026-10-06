/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Free-space-drift turbo. It observes bounded minimum free-space headroom
 * without deleting files, moving paths, remounting volumes, or writing.
 */

export const STORAGE_CAPACITY_FREE_SPACE_DRIFT_TURBO_ID = 'storage-capacity.free-space-drift';
export const STORAGE_CAPACITY_FREE_SPACE_DRIFT_TURBO_VERSION = 1;
export const STORAGE_CAPACITY_FREE_SPACE_DRIFT_TRIGGERS = Object.freeze([
  'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function freePercent(total, free) {
  if (total === null || total === 0 || free === null) return null;
  return Math.min(100, Math.max(0, (Math.min(total, free) / total) * 100));
}
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Free-space-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Free-space-drift requires a system-facts snapshot');
  if (!Array.isArray(snapshot.storage)) throw new TypeError('Free-space-drift snapshot requires a storage list');
  return snapshot;
}
function requireTrigger(trigger) {
  if (!STORAGE_CAPACITY_FREE_SPACE_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported free-space-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}
function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Free-space-drift windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}
function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Free-space-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}
function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Free-space-drift ${name} must be an integer from 1 to 64`);
  }
  return value;
}
function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('Free-space-drift headroomThreshold must be between 0 and 100');
  }
  return value;
}
function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Free-space-drift clock must return a number');
  return timestamp;
}
function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}
function aggregate(snapshot, headroomThreshold) {
  const source = requireSnapshot(snapshot);
  const rows = source.storage.filter(isRecord).map((item) => {
    const total = nonNegative(item.totalBytes);
    const free = total === null ? nonNegative(item.freeBytes)
      : Math.min(total, nonNegative(item.freeBytes));
    return freePercent(total, free);
  });
  if (!environmentKnown(source)) return Object.freeze({ state: 'incomplete', storageCount: rows.length, minimumFreePercent: null, pressured: false });
  if (rows.length === 0) return Object.freeze({ state: 'no-storage', storageCount: 0, minimumFreePercent: null, pressured: false });
  if (rows.some((value) => value === null)) return Object.freeze({ state: 'incomplete', storageCount: rows.length, minimumFreePercent: null, pressured: false });
  const minimumFreePercent = Math.min(...rows);
  return Object.freeze({ state: 'observed', storageCount: rows.length, minimumFreePercent, pressured: minimumFreePercent <= headroomThreshold });
}
function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, pressureSampleCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-storage')) return 'no-storage';
  if (incompleteCount > 0) return 'incomplete-headroom-evidence';
  if (pressureSampleCount >= persistenceThreshold) return 'headroom-pressure-sustained';
  if (pressureSampleCount > 0) return 'headroom-pressure-observed';
  return 'stable-headroom';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-headroom-samples']);
  if (state === 'no-storage') return Object.freeze(['no-storage-headroom-review']);
  if (state === 'incomplete-headroom-evidence') return Object.freeze(['request-headroom-observation']);
  if (state === 'headroom-pressure-sustained') return Object.freeze(['review-free-space', 'hold-automatic-cleanup']);
  if (state === 'headroom-pressure-observed') return Object.freeze(['observe-next-headroom-sample']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}
export function runStorageCapacityFreeSpaceDriftTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, headroomThreshold = 20,
  persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Free-space-drift samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredThreshold = requireThreshold(headroomThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => aggregate(sample, requiredThreshold));
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noStorageCount = evidence.filter((item) => item.state === 'no-storage').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const pressureSampleCount = evidence.filter((item) => item.state === 'observed' && item.pressured).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, pressureSampleCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ storageCount: 0, minimumFreePercent: null });
  return Object.freeze({
    protocolVersion: 1, turbo: STORAGE_CAPACITY_FREE_SPACE_DRIFT_TURBO_ID,
    turboVersion: STORAGE_CAPACITY_FREE_SPACE_DRIFT_TURBO_VERSION, trigger,
    generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length,
    minimumSamples: requiredSamples, headroomThreshold: requiredThreshold,
    persistenceThreshold: requiredPersistence, storageCount: latest.storageCount,
    minimumFreePercent: latest.minimumFreePercent, observedCount, incompleteCount,
    noStorageCount, pressureSampleCount, state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state), actions: EMPTY_ARRAY
  });
}
