/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Health-degradation turbo. It observes bounded storage health labels
 * without repairing devices, remounting volumes, or changing files.
 */

export const STORAGE_HEALTH_HEALTH_DEGRADATION_TURBO_ID = 'storage-health.health-degradation';
export const STORAGE_HEALTH_HEALTH_DEGRADATION_TURBO_VERSION = 1;
export const STORAGE_HEALTH_HEALTH_DEGRADATION_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'failed']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function healthOf(value) {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  return HEALTH_STATES.includes(normalized) ? normalized : 'unknown';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Health-degradation snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Health-degradation requires a system-facts snapshot');
  if (!Array.isArray(snapshot.storage)) throw new TypeError('Health-degradation snapshot requires a storage list');
  return snapshot;
}

function requireTrigger(trigger) {
  if (!STORAGE_HEALTH_HEALTH_DEGRADATION_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported health-degradation trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Health-degradation windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Health-degradation minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Health-degradation ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Health-degradation clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function aggregate(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.storage.filter(isRecord).map((item) => healthOf(item.health));
  if (!environmentKnown(source)) {
    return Object.freeze({ state: 'incomplete', storageCount: rows.length, failedCount: 0,
      degradedCount: 0, unknownCount: rows.length });
  }
  if (rows.length === 0) {
    return Object.freeze({ state: 'no-storage', storageCount: 0, failedCount: 0,
      degradedCount: 0, unknownCount: 0 });
  }
  const unknownCount = rows.filter((health) => health === 'unknown').length;
  if (unknownCount > 0) {
    return Object.freeze({ state: 'incomplete', storageCount: rows.length, failedCount: 0,
      degradedCount: 0, unknownCount });
  }
  const failedCount = rows.filter((health) => health === 'failed').length;
  const degradedCount = rows.filter((health) => health === 'degraded').length;
  return Object.freeze({ state: 'observed', storageCount: rows.length, failedCount, degradedCount, unknownCount: 0 });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, failureSampleCount,
  degradationSampleCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-storage')) return 'no-storage';
  if (incompleteCount > 0) return 'incomplete-health-evidence';
  if (failureSampleCount >= persistenceThreshold) return 'health-failure-sustained';
  if (degradationSampleCount > 0) return 'health-degradation-observed';
  return 'healthy-storage';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-health-samples']);
  if (state === 'no-storage') return Object.freeze(['no-storage-health-review']);
  if (state === 'incomplete-health-evidence') return Object.freeze(['request-health-observation']);
  if (state === 'health-failure-sustained') return Object.freeze(['protect-data', 'request-user-approved-storage-review']);
  if (state === 'health-degradation-observed') return Object.freeze(['observe-storage-health']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runStorageHealthHealthDegradationTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Health-degradation samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => aggregate(sample));
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noStorageCount = evidence.filter((item) => item.state === 'no-storage').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const failureSampleCount = evidence.filter((item) => item.state === 'observed' && item.failedCount > 0).length;
  const degradationSampleCount = evidence.filter((item) => item.state === 'observed'
    && (item.failedCount > 0 || item.degradedCount > 0)).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount,
    failureSampleCount, degradationSampleCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ storageCount: 0, failedCount: 0, degradedCount: 0, unknownCount: 0 });
  return Object.freeze({
    protocolVersion: 1,
    turbo: STORAGE_HEALTH_HEALTH_DEGRADATION_TURBO_ID,
    turboVersion: STORAGE_HEALTH_HEALTH_DEGRADATION_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    storageCount: latest.storageCount,
    failedCount: latest.failedCount,
    degradedCount: latest.degradedCount,
    unknownCount: latest.unknownCount,
    observedCount,
    incompleteCount,
    noStorageCount,
    failureSampleCount,
    degradationSampleCount,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
