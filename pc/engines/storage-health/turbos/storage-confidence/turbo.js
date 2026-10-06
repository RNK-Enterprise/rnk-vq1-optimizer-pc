/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Storage-confidence turbo. It scores bounded storage fact completeness
 * without probing devices, changing mounts, or writing files.
 */

export const STORAGE_HEALTH_STORAGE_CONFIDENCE_TURBO_ID = 'storage-health.storage-confidence';
export const STORAGE_HEALTH_STORAGE_CONFIDENCE_TURBO_VERSION = 1;
export const STORAGE_HEALTH_STORAGE_CONFIDENCE_TRIGGERS = Object.freeze([
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

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validHealth(value) {
  return typeof value === 'string' && HEALTH_STATES.includes(value.trim().toLowerCase());
}

function completeRow(row) {
  return (text(row.mount) || text(row.device))
    && Number.isFinite(row.usedPercent) && row.usedPercent >= 0 && row.usedPercent <= 100
    && validHealth(row.health) && typeof row.readOnly === 'boolean';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Storage-confidence snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Storage-confidence requires a system-facts snapshot');
  if (!Array.isArray(snapshot.storage)) throw new TypeError('Storage-confidence snapshot requires a storage list');
  return snapshot;
}

function requireTrigger(trigger) {
  if (!STORAGE_HEALTH_STORAGE_CONFIDENCE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported storage-confidence trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Storage-confidence windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Storage-confidence minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Storage-confidence ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireRatio(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('Storage-confidence completenessThreshold must be between 0 and 1');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Storage-confidence clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function aggregate(snapshot, completenessThreshold) {
  const source = requireSnapshot(snapshot);
  const rows = source.storage.filter(isRecord);
  if (!environmentKnown(source)) {
    return Object.freeze({ state: 'incomplete', storageCount: rows.length, completeCount: 0,
      incompleteRowCount: rows.length, completenessRatio: null, lowConfidence: false });
  }
  if (rows.length === 0) {
    return Object.freeze({ state: 'no-storage', storageCount: 0, completeCount: 0,
      incompleteRowCount: 0, completenessRatio: null, lowConfidence: false });
  }
  const completeCount = rows.filter(completeRow).length;
  const incompleteRowCount = rows.length - completeCount;
  const completenessRatio = completeCount / rows.length;
  return Object.freeze({ state: 'observed', storageCount: rows.length, completeCount,
    incompleteRowCount, completenessRatio, lowConfidence: completenessRatio < completenessThreshold });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, lowConfidenceSampleCount,
  persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-storage')) return 'no-storage';
  if (incompleteCount > 0) return 'incomplete-confidence-evidence';
  if (lowConfidenceSampleCount >= persistenceThreshold) return 'low-confidence-sustained';
  if (lowConfidenceSampleCount > 0) return 'low-confidence-observed';
  return 'complete-storage-observation';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-storage-facts']);
  if (state === 'no-storage') return Object.freeze(['no-storage-confidence-review']);
  if (state === 'incomplete-confidence-evidence') return Object.freeze(['request-environment-profile']);
  if (state === 'low-confidence-sustained') return Object.freeze(['request-complete-storage-facts']);
  if (state === 'low-confidence-observed') return Object.freeze(['observe-storage-fact-completeness']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runStorageHealthStorageConfidenceTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  completenessThreshold = 0.75,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Storage-confidence samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredThreshold = requireRatio(completenessThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => aggregate(sample, requiredThreshold));
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noStorageCount = evidence.filter((item) => item.state === 'no-storage').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const lowConfidenceSampleCount = evidence.filter((item) => item.state === 'observed'
    && item.lowConfidence).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount,
    lowConfidenceSampleCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ storageCount: 0, completeCount: 0,
    incompleteRowCount: 0, completenessRatio: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: STORAGE_HEALTH_STORAGE_CONFIDENCE_TURBO_ID,
    turboVersion: STORAGE_HEALTH_STORAGE_CONFIDENCE_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    completenessThreshold: requiredThreshold,
    persistenceThreshold: requiredPersistence,
    storageCount: latest.storageCount,
    completeCount: latest.completeCount,
    incompleteRowCount: latest.incompleteRowCount,
    completenessRatio: latest.completenessRatio,
    observedCount,
    incompleteCount,
    noStorageCount,
    lowConfidenceSampleCount,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
