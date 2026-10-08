/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Capacity-evidence turbo. It scores bounded mount, total, and free-byte
 * evidence without probing devices, changing files, or changing mounts.
 */

export const STORAGE_CAPACITY_CAPACITY_EVIDENCE_TURBO_ID = 'storage-capacity.capacity-evidence';
export const STORAGE_CAPACITY_CAPACITY_EVIDENCE_TURBO_VERSION = 1;
export const STORAGE_CAPACITY_CAPACITY_EVIDENCE_TRIGGERS = Object.freeze([
  'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function completeRow(row) { return text(row.mount) && nonNegative(row.totalBytes) !== null && nonNegative(row.freeBytes) !== null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Capacity-evidence snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Capacity-evidence requires a system-facts snapshot');
  if (!Array.isArray(snapshot.storage)) throw new TypeError('Capacity-evidence snapshot requires a storage list');
  return snapshot;
}
function requireTrigger(trigger) {
  if (!STORAGE_CAPACITY_CAPACITY_EVIDENCE_TRIGGERS.includes(trigger)) throw new Error(`Unsupported capacity-evidence trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) throw new RangeError('Capacity-evidence windowSize must be an integer from 1 to 64');
  return windowSize;
}
function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) throw new RangeError('Capacity-evidence minimumSamples must fit inside the window');
  return minimumSamples;
}
function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) throw new RangeError(`Capacity-evidence ${name} must be an integer from 1 to 64`);
  return value;
}
function requireRatio(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Capacity-evidence evidenceThreshold must be between 0 and 1');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Capacity-evidence clock must return a number'); return timestamp; }
function environmentKnown(snapshot) { return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown'; }
function aggregate(snapshot, evidenceThreshold) {
  const source = requireSnapshot(snapshot); const rows = source.storage.filter(isRecord);
  if (!environmentKnown(source)) return Object.freeze({ state: 'incomplete', storageCount: rows.length, completeCount: 0, incompleteRowCount: rows.length, evidenceRatio: null, gap: false });
  if (rows.length === 0) return Object.freeze({ state: 'no-storage', storageCount: 0, completeCount: 0, incompleteRowCount: 0, evidenceRatio: null, gap: false });
  const completeCount = rows.filter(completeRow).length; const incompleteRowCount = rows.length - completeCount;
  const evidenceRatio = completeCount / rows.length;
  return Object.freeze({ state: 'observed', storageCount: rows.length, completeCount, incompleteRowCount, evidenceRatio, gap: evidenceRatio < evidenceThreshold });
}
function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, gapSampleCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-storage')) return 'no-storage';
  if (incompleteCount > 0) return 'incomplete-capacity-evidence';
  if (gapSampleCount >= persistenceThreshold) return 'capacity-evidence-gap-sustained';
  if (gapSampleCount > 0) return 'capacity-evidence-gap-observed';
  return 'complete-capacity-evidence';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-capacity-facts']);
  if (state === 'no-storage') return Object.freeze(['no-storage-evidence-review']);
  if (state === 'incomplete-capacity-evidence') return Object.freeze(['request-environment-profile']);
  if (state === 'capacity-evidence-gap-sustained') return Object.freeze(['request-complete-capacity-facts']);
  if (state === 'capacity-evidence-gap-observed') return Object.freeze(['observe-capacity-fact-completeness']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) { if (sampleCount === 0) return 0; return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000; }
export function runStorageCapacityCapacityEvidenceTurbo(samples = [], { trigger, windowSize = 16, minimumSamples = 2, evidenceThreshold = 0.75, persistenceThreshold = 2, now = Date.now } = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Capacity-evidence samples must be an array');
  const boundedWindow = requireWindowSize(windowSize); const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredThreshold = requireRatio(evidenceThreshold); const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow); const timestamp = requireClock(now); const evidence = selected.map((sample) => aggregate(sample, requiredThreshold));
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length; const noStorageCount = evidence.filter((item) => item.state === 'no-storage').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length; const gapSampleCount = evidence.filter((item) => item.state === 'observed' && item.gap).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, gapSampleCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ storageCount: 0, completeCount: 0, incompleteRowCount: 0, evidenceRatio: null });
  return Object.freeze({ protocolVersion: 1, turbo: STORAGE_CAPACITY_CAPACITY_EVIDENCE_TURBO_ID, turboVersion: STORAGE_CAPACITY_CAPACITY_EVIDENCE_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    evidenceThreshold: requiredThreshold, persistenceThreshold: requiredPersistence, storageCount: latest.storageCount,
    completeCount: latest.completeCount, incompleteRowCount: latest.incompleteRowCount, evidenceRatio: latest.evidenceRatio,
    observedCount, incompleteCount, noStorageCount, gapSampleCount, state,
    confidence: confidence(selected.length, observedCount, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
