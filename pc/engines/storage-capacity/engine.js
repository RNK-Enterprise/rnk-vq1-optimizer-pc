/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Storage-capacity engine. It reports bounded total/free capacity and
 * headroom without deleting, moving, or changing files.
 */

export const STORAGE_CAPACITY_ENGINE_ID = 'storage-capacity';
export const STORAGE_CAPACITY_ENGINE_VERSION = 1;
export const STORAGE_CAPACITY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const PRESSURE_LEVELS = Object.freeze(['normal', 'warning', 'critical', 'emergency', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeStoragePressure(value) {
  if (!isRecord(value)) return null;
  return Object.freeze({
    level: PRESSURE_LEVELS.includes(value.level) ? value.level : 'unknown',
    totalBytes: nonNegative(value.totalBytes),
    freeBytes: nonNegative(value.freeBytes),
    freePercent: nonNegative(value.freePercent),
    targetFreeBytes: nonNegative(value.targetFreeBytes),
    belowTargetFreeFloor: value.belowTargetFreeFloor === true,
    reclaimableBytesNeeded: nonNegative(value.reclaimableBytesNeeded),
    policyVersion: Number.isInteger(value.policyVersion) && value.policyVersion > 0 ? value.policyVersion : null
  });
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Storage-capacity facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Storage-capacity requires system-facts facts');
  if (!Array.isArray(facts.storage)) throw new TypeError('Storage-capacity facts require a storage list');
  return facts;
}

function requireTrigger(trigger) {
  if (!STORAGE_CAPACITY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported storage-capacity trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Storage-capacity clock must return a number');
  return timestamp;
}

function freePercent(total, free) {
  if (total === null || total === 0 || free === null) return null;
  return Math.min(100, Math.max(0, (Math.min(total, free) / total) * 100));
}

function minimum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : Math.min(...values);
}

function sum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
}

function levelFor(freePercentValue) {
  if (freePercentValue === null) return 'unknown';
  if (freePercentValue <= 10) return 'high';
  if (freePercentValue <= 20) return 'elevated';
  return 'normal';
}

function operatingState(environment, count, level) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-storage';
  if (level === 'unknown') return 'observation-required';
  if (level === 'high') return 'capacity-review';
  if (level === 'elevated') return 'watch';
  return 'observe';
}

function recommendations(environment, count, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-storage-capacity-review']);
  if (level === 'unknown') return Object.freeze(['request-storage-capacity-observation']);
  if (level === 'high') return Object.freeze(['review-free-space-before-workload']);
  if (level === 'elevated') return Object.freeze(['observe-storage-headroom']);
  return Object.freeze(['no-change']);
}

function confidence(environment, count, total, free, minimumFreePercent) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (count > 0) score += 0.2;
  if (total !== null) score += 0.3;
  if (free !== null) score += 0.2;
  if (minimumFreePercent !== null) score += 0.1;
  return Math.round(score * 10000) / 10000;
}

export function runStorageCapacityEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const storage = source.storage.filter(isRecord).map((item) => {
    const total = nonNegative(item.totalBytes);
    const free = total === null ? nonNegative(item.freeBytes) : Math.min(total, nonNegative(item.freeBytes));
    return {
      mount: text(item.mount),
      total,
      free,
      freePercent: freePercent(total, free)
    };
  });
  const total = sum(storage, (item) => item.total);
  const free = sum(storage, (item) => item.free);
  const minimumFreePercent = minimum(storage, (item) => item.freePercent);
  const level = levelFor(minimumFreePercent);
  const storagePressure = normalizeStoragePressure(source.storagePressure);
  return Object.freeze({
    protocolVersion: 1,
    engine: STORAGE_CAPACITY_ENGINE_ID,
    engineVersion: STORAGE_CAPACITY_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    storageCount: storage.length,
    mounts: Object.freeze(storage.map((item) => item.mount).filter(Boolean)),
    totalBytes: total,
    freeBytes: free,
    minimumFreePercent,
    storagePressure,
    level,
    state: operatingState(environment, storage.length, level),
    confidence: confidence(environment, storage.length, total, free, minimumFreePercent),
    recommendations: recommendations(environment, storage.length, level),
    actions: EMPTY_ARRAY
  });
}
