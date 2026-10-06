/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Read-only-drift turbo. It observes bounded read-only storage evidence
 * without remounting volumes, changing permissions, or writing files.
 */

export const STORAGE_HEALTH_READ_ONLY_DRIFT_TURBO_ID = 'storage-health.read-only-drift';
export const STORAGE_HEALTH_READ_ONLY_DRIFT_TURBO_VERSION = 1;
export const STORAGE_HEALTH_READ_ONLY_DRIFT_TRIGGERS = Object.freeze([
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

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Read-only-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Read-only-drift requires a system-facts snapshot');
  if (!Array.isArray(snapshot.storage)) throw new TypeError('Read-only-drift snapshot requires a storage list');
  return snapshot;
}

function requireTrigger(trigger) {
  if (!STORAGE_HEALTH_READ_ONLY_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported read-only-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Read-only-drift windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Read-only-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Read-only-drift ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireRatio(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('Read-only-drift readOnlyThreshold must be between 0 and 1');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Read-only-drift clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function aggregate(snapshot, readOnlyThreshold) {
  const source = requireSnapshot(snapshot);
  const rows = source.storage.filter(isRecord).map((item) => item.readOnly);
  if (!environmentKnown(source)) {
    return Object.freeze({ state: 'incomplete', storageCount: rows.length, readOnlyCount: 0,
      readOnlyRatio: null, elevated: false });
  }
  if (rows.length === 0) {
    return Object.freeze({ state: 'no-storage', storageCount: 0, readOnlyCount: 0,
      readOnlyRatio: null, elevated: false });
  }
  if (rows.some((readOnly) => typeof readOnly !== 'boolean')) {
    return Object.freeze({ state: 'incomplete', storageCount: rows.length, readOnlyCount: 0,
      readOnlyRatio: null, elevated: false });
  }
  const readOnlyCount = rows.filter(Boolean).length;
  const readOnlyRatio = readOnlyCount / rows.length;
  return Object.freeze({ state: 'observed', storageCount: rows.length, readOnlyCount,
    readOnlyRatio, elevated: readOnlyRatio >= readOnlyThreshold });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, elevatedSampleCount,
  persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-storage')) return 'no-storage';
  if (incompleteCount > 0) return 'incomplete-read-only-evidence';
  if (elevatedSampleCount >= persistenceThreshold) return 'read-only-increase-sustained';
  if (elevatedSampleCount > 0) return 'read-only-observed';
  return 'stable-read-only';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-read-only-samples']);
  if (state === 'no-storage') return Object.freeze(['no-storage-read-only-review']);
  if (state === 'incomplete-read-only-evidence') return Object.freeze(['request-read-only-observation']);
  if (state === 'read-only-increase-sustained') return Object.freeze(['review-mount-state', 'hold-remount-policy']);
  if (state === 'read-only-observed') return Object.freeze(['observe-read-only-state']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runStorageHealthReadOnlyDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  readOnlyThreshold = 0.5,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Read-only-drift samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredThreshold = requireRatio(readOnlyThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => aggregate(sample, requiredThreshold));
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noStorageCount = evidence.filter((item) => item.state === 'no-storage').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const elevatedSampleCount = evidence.filter((item) => item.state === 'observed' && item.elevated).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount,
    elevatedSampleCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ storageCount: 0, readOnlyCount: 0, readOnlyRatio: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: STORAGE_HEALTH_READ_ONLY_DRIFT_TURBO_ID,
    turboVersion: STORAGE_HEALTH_READ_ONLY_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    readOnlyThreshold: requiredThreshold,
    persistenceThreshold: requiredPersistence,
    storageCount: latest.storageCount,
    readOnlyCount: latest.readOnlyCount,
    readOnlyRatio: latest.readOnlyRatio,
    observedCount,
    incompleteCount,
    noStorageCount,
    elevatedSampleCount,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
