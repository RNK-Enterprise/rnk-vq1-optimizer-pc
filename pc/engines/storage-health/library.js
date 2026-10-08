/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Storage-health library. It classifies occupancy and health evidence for
 * review and never repairs, remounts, deletes, organizes, or writes files.
 */

export const STORAGE_HEALTH_LIBRARY_ID = 'storage-health-library';
export const STORAGE_HEALTH_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'failed']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function healthOf(value) {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  return HEALTH_STATES.includes(normalized) ? normalized : 'unknown';
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Storage-health library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Storage-health library requires normalized system facts');
  }
  if (!Array.isArray(facts.storage)) throw new TypeError('Storage-health library requires a storage list');
  return facts;
}

function maximum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

function levelFor(maxUsed, degradedCount, failedCount) {
  if (failedCount > 0 || (maxUsed !== null && maxUsed >= 90)) return 'high';
  if (degradedCount > 0 || (maxUsed !== null && maxUsed >= 80)) return 'elevated';
  if (maxUsed === null) return 'unknown';
  return 'normal';
}

function operatingState(environment, count, unknownCount, failedCount, level) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-storage';
  if (failedCount > 0) return 'protect-data';
  if (unknownCount === count && level === 'unknown') return 'observation-required';
  if (level === 'high') return 'capacity-review';
  if (level === 'elevated') return 'watch';
  return 'observe';
}

function recommendations(environment, count, unknownCount, failedCount, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-storage-health-review']);
  if (failedCount > 0) return Object.freeze(['protect-data', 'request-user-approved-storage-review']);
  if (unknownCount === count && level === 'unknown') {
    return Object.freeze(['request-storage-health-observation']);
  }
  if (level === 'high') return Object.freeze(['review-free-space-before-workload']);
  if (level === 'elevated') return Object.freeze(['observe-storage-headroom']);
  return Object.freeze(['no-change']);
}

export function classifyStorageHealth(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const storage = source.storage.filter(isRecord).map((item) => ({
    mount: text(item.mount),
    device: text(item.device),
    usedPercent: percent(item.usedPercent),
    health: healthOf(item.health),
    readOnly: item.readOnly === true
  }));
  const maxUsed = maximum(storage, (item) => item.usedPercent);
  const degradedCount = storage.filter((item) => item.health === 'degraded').length;
  const failedCount = storage.filter((item) => item.health === 'failed').length;
  const unknownCount = storage.filter((item) => item.health === 'unknown').length;
  const level = levelFor(maxUsed, degradedCount, failedCount);
  const state = operatingState(environment, storage.length, unknownCount, failedCount, level);
  return Object.freeze({
    library: STORAGE_HEALTH_LIBRARY_ID,
    libraryVersion: STORAGE_HEALTH_LIBRARY_VERSION,
    environment,
    storageCount: storage.length,
    mounts: Object.freeze(storage.map((item) => item.mount).filter(Boolean)),
    devices: Object.freeze(storage.map((item) => item.device).filter(Boolean)),
    maximumUsedPercent: maxUsed,
    degradedCount,
    failedCount,
    unknownHealthCount: unknownCount,
    readOnlyCount: storage.filter((item) => item.readOnly).length,
    level,
    state,
    recommendations: recommendations(environment, storage.length, unknownCount, failedCount, level)
  });
}

export function compareStorageHealth(previous, current) {
  const before = classifyStorageHealth(previous);
  const after = classifyStorageHealth(current);
  const levelChanged = before.level !== after.level;
  const failedChanged = before.failedCount !== after.failedCount;
  const countChanged = before.storageCount !== after.storageCount;
  const capacityChanged = before.maximumUsedPercent !== after.maximumUsedPercent;
  return Object.freeze({
    changed: levelChanged || failedChanged || countChanged || capacityChanged,
    levelChanged,
    failedChanged,
    countChanged,
    capacityChanged,
    readOnlyChanged: before.readOnlyCount !== after.readOnlyCount
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Storage-health library clock must return a number');
  return timestamp;
}

export function buildStorageHealthEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Storage-health library trigger is required');
  }
  return Object.freeze({
    library: STORAGE_HEALTH_LIBRARY_ID,
    libraryVersion: STORAGE_HEALTH_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyStorageHealth(facts)
  });
}

export function createStorageHealthLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Storage-health library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: STORAGE_HEALTH_LIBRARY_ID,
    version: STORAGE_HEALTH_LIBRARY_VERSION,
    classify: classifyStorageHealth,
    compare: compareStorageHealth,
    envelope: (facts, envelopeOptions = {}) => buildStorageHealthEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
