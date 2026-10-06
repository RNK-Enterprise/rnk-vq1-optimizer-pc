/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Storage-health engine. It classifies bounded storage occupancy and health
 * evidence without repairing, remounting, deleting, or changing files.
 */

export const STORAGE_HEALTH_ENGINE_ID = 'storage-health';
export const STORAGE_HEALTH_ENGINE_VERSION = 1;
export const STORAGE_HEALTH_TRIGGERS = Object.freeze([
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
  if (!isRecord(facts)) throw new TypeError('Storage-health facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Storage-health requires system-facts facts');
  if (!Array.isArray(facts.storage)) throw new TypeError('Storage-health facts require a storage list');
  return facts;
}

function requireTrigger(trigger) {
  if (!STORAGE_HEALTH_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported storage-health trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Storage-health clock must return a number');
  return timestamp;
}

function maximum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : Math.max(...values);
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

function levelFor(maxUsed, degradedCount, failedCount) {
  if (failedCount > 0 || (maxUsed !== null && maxUsed >= 90)) return 'high';
  if (degradedCount > 0 || (maxUsed !== null && maxUsed >= 80)) return 'elevated';
  if (maxUsed === null) return 'unknown';
  return 'normal';
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

function confidence(environment, count, unknownCount, maxUsed) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (count > 0) score += 0.2;
  if (maxUsed !== null) score += 0.4;
  if (count > 0 && unknownCount === 0) score += 0.2;
  return Math.round(score * 10000) / 10000;
}

export function runStorageHealthEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
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
    protocolVersion: 1,
    engine: STORAGE_HEALTH_ENGINE_ID,
    engineVersion: STORAGE_HEALTH_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
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
    confidence: confidence(environment, storage.length, unknownCount, maxUsed),
    recommendations: recommendations(environment, storage.length, unknownCount, failedCount, level),
    actions: EMPTY_ARRAY
  });
}
