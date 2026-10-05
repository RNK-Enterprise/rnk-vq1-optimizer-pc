/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Storage-capacity library. It reports bounded total/free capacity for review
 * and never deletes, moves, organizes, repairs, or changes files.
 */

export const STORAGE_CAPACITY_LIBRARY_ID = 'storage-capacity-library';
export const STORAGE_CAPACITY_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Storage-capacity library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Storage-capacity library requires normalized system facts');
  }
  if (!Array.isArray(facts.storage)) {
    throw new TypeError('Storage-capacity library requires a storage list');
  }
  return facts;
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

function recommendations(environment, count, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-storage-capacity-review']);
  if (level === 'unknown') return Object.freeze(['request-storage-capacity-observation']);
  if (level === 'high') return Object.freeze(['review-free-space-before-workload']);
  if (level === 'elevated') return Object.freeze(['observe-storage-headroom']);
  return Object.freeze(['no-change']);
}

export function classifyStorageCapacity(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const storage = source.storage.filter(isRecord).map((item) => {
    const total = nonNegative(item.totalBytes);
    const observedFree = nonNegative(item.freeBytes);
    const free = total === null || observedFree === null ? observedFree
      : Math.min(total, observedFree);
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
  return Object.freeze({
    library: STORAGE_CAPACITY_LIBRARY_ID,
    libraryVersion: STORAGE_CAPACITY_LIBRARY_VERSION,
    environment,
    storageCount: storage.length,
    mounts: Object.freeze(storage.map((item) => item.mount).filter(Boolean)),
    totalBytes: total,
    freeBytes: free,
    minimumFreePercent,
    level,
    recommendations: recommendations(environment, storage.length, level)
  });
}

export function compareStorageCapacity(previous, current) {
  const before = classifyStorageCapacity(previous);
  const after = classifyStorageCapacity(current);
  const levelChanged = before.level !== after.level;
  const freeChanged = before.freeBytes !== after.freeBytes;
  const totalChanged = before.totalBytes !== after.totalBytes;
  const countChanged = before.storageCount !== after.storageCount;
  return Object.freeze({
    changed: levelChanged || freeChanged || totalChanged || countChanged,
    levelChanged,
    freeChanged,
    totalChanged,
    countChanged,
    minimumFreeChanged: before.minimumFreePercent !== after.minimumFreePercent
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Storage-capacity library clock must return a number');
  return timestamp;
}

export function buildStorageCapacityEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Storage-capacity library trigger is required');
  }
  return Object.freeze({
    library: STORAGE_CAPACITY_LIBRARY_ID,
    libraryVersion: STORAGE_CAPACITY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyStorageCapacity(facts)
  });
}

export function createStorageCapacityLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Storage-capacity library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: STORAGE_CAPACITY_LIBRARY_ID,
    version: STORAGE_CAPACITY_LIBRARY_VERSION,
    classify: classifyStorageCapacity,
    compare: compareStorageCapacity,
    envelope: (facts, envelopeOptions = {}) => buildStorageCapacityEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
