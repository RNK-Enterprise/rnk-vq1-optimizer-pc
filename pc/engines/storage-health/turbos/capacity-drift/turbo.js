/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Capacity-drift turbo. It observes bounded storage occupancy samples
 * without deleting files, organizing paths, remounting volumes, or writing.
 */

export const STORAGE_HEALTH_CAPACITY_DRIFT_TURBO_ID = 'storage-health.capacity-drift';
export const STORAGE_HEALTH_CAPACITY_DRIFT_TURBO_VERSION = 1;
export const STORAGE_HEALTH_CAPACITY_DRIFT_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Capacity-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Capacity-drift requires a system-facts snapshot');
  if (!Array.isArray(snapshot.storage)) throw new TypeError('Capacity-drift snapshot requires a storage list');
  return snapshot;
}

function requireTrigger(trigger) {
  if (!STORAGE_HEALTH_CAPACITY_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported capacity-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Capacity-drift windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Capacity-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Capacity-drift ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('Capacity-drift capacityThreshold must be between 0 and 100');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Capacity-drift clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function aggregate(snapshot, capacityThreshold) {
  const source = requireSnapshot(snapshot);
  const rows = source.storage.filter(isRecord).map((item) => percent(item.usedPercent));
  if (!environmentKnown(source)) {
    return Object.freeze({ state: 'incomplete', storageCount: rows.length, maximumUsedPercent: null, pressured: false });
  }
  if (rows.length === 0) {
    return Object.freeze({ state: 'no-storage', storageCount: 0, maximumUsedPercent: null, pressured: false });
  }
  if (rows.some((used) => used === null)) {
    return Object.freeze({ state: 'incomplete', storageCount: rows.length, maximumUsedPercent: null, pressured: false });
  }
  const maximumUsedPercent = Math.max(...rows);
  return Object.freeze({
    state: 'observed',
    storageCount: rows.length,
    maximumUsedPercent,
    pressured: maximumUsedPercent >= capacityThreshold
  });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, pressureSampleCount,
  persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-storage')) return 'no-storage';
  if (incompleteCount > 0) return 'incomplete-capacity-evidence';
  if (pressureSampleCount >= persistenceThreshold) return 'capacity-pressure-sustained';
  if (pressureSampleCount > 0) return 'capacity-pressure-observed';
  return 'stable-capacity';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-capacity-samples']);
  if (state === 'no-storage') return Object.freeze(['no-storage-capacity-review']);
  if (state === 'incomplete-capacity-evidence') return Object.freeze(['request-capacity-observation']);
  if (state === 'capacity-pressure-sustained') return Object.freeze(['review-free-space', 'hold-automatic-cleanup']);
  if (state === 'capacity-pressure-observed') return Object.freeze(['observe-next-capacity-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runStorageHealthCapacityDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  capacityThreshold = 90,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Capacity-drift samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredThreshold = requireThreshold(capacityThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => aggregate(sample, requiredThreshold));
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noStorageCount = evidence.filter((item) => item.state === 'no-storage').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const pressureSampleCount = evidence.filter((item) => item.state === 'observed' && item.pressured).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount,
    pressureSampleCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ storageCount: 0, maximumUsedPercent: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: STORAGE_HEALTH_CAPACITY_DRIFT_TURBO_ID,
    turboVersion: STORAGE_HEALTH_CAPACITY_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    capacityThreshold: requiredThreshold,
    persistenceThreshold: requiredPersistence,
    storageCount: latest.storageCount,
    maximumUsedPercent: latest.maximumUsedPercent,
    observedCount,
    incompleteCount,
    noStorageCount,
    pressureSampleCount,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
