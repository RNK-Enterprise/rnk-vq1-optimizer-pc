/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Background-services ownership-review turbo. It preserves explicit
 * user-owned evidence and refuses to infer service ownership.
 */

export const BACKGROUND_OWNERSHIP_TURBO_ID = 'background-services.ownership-review';
export const BACKGROUND_OWNERSHIP_TURBO_VERSION = 1;
export const BACKGROUND_OWNERSHIP_TRIGGERS = Object.freeze([
  'install.preflight', 'system.facts.request', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function ownershipOf(service) {
  if (typeof service.userOwned !== 'boolean') return 'unknown';
  return service.userOwned ? 'user-owned' : 'system-owned';
}
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Background-services ownership-review snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Background-services ownership-review requires a system-facts snapshot');
  if (!Array.isArray(snapshot.services)) throw new TypeError('Background-services ownership-review snapshot requires a service list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.services.filter(isRecord);
  const ownership = rows.map(ownershipOf);
  return Object.freeze({
    environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    serviceCount: rows.length, userOwnedCount: ownership.filter((item) => item === 'user-owned').length,
    systemOwnedCount: ownership.filter((item) => item === 'system-owned').length,
    unknownOwnershipCount: ownership.filter((item) => item === 'unknown').length,
    signature: ownership.join('|')
  });
}
function requireTrigger(trigger) {
  if (!BACKGROUND_OWNERSHIP_TRIGGERS.includes(trigger)) throw new Error(`Unsupported background-services ownership-review trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Background-services ownership-review windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Background-services ownership-review minimumSamples must fit inside the window');
  return value;
}
function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Background-services ownership-review clock must return a number');
  return timestamp;
}
function stateFor(sampleCount, minimumSamples, serviceCount, userOwnedCount, unknownCount) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (serviceCount === 0) return 'no-services';
  if (userOwnedCount > 0) return 'user-owned-review';
  if (unknownCount > 0) return 'ownership-observation-required';
  return 'system-owned-observe';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-service-ownership-samples']);
  if (state === 'no-services') return Object.freeze(['no-background-service-review']);
  if (state === 'user-owned-review') return Object.freeze(['preserve-user-owned-service-boundary']);
  if (state === 'ownership-observation-required') return Object.freeze(['request-explicit-service-ownership']);
  return Object.freeze(['no-change']);
}
export function runBackgroundOwnershipReviewTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Background-services ownership-review samples must be an array');
  const boundedWindow = requireWindow(windowSize);
  const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const changes = evidence.slice(1).filter((current, index) => current.signature !== evidence[index].signature);
  const latest = evidence.at(-1);
  const state = stateFor(selected.length, requiredSamples, latest?.serviceCount || 0,
    latest?.userOwnedCount || 0, latest?.unknownOwnershipCount || 0);
  return Object.freeze({
    protocolVersion: 1, turbo: BACKGROUND_OWNERSHIP_TURBO_ID, turboVersion: BACKGROUND_OWNERSHIP_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length,
    minimumSamples: requiredSamples, serviceCount: latest?.serviceCount || 0,
    userOwnedCount: latest?.userOwnedCount || 0, systemOwnedCount: latest?.systemOwnedCount || 0,
    unknownOwnershipCount: latest?.unknownOwnershipCount || 0, comparisonCount: Math.max(0, selected.length - 1),
    changeCount: changes.length, finalEnvironment: latest?.environment || 'unknown', state,
    confidence: selected.length === 0 ? 0 : Math.round(((latest?.serviceCount || 0) - (latest?.unknownOwnershipCount || 0))
      / Math.max(1, latest?.serviceCount || 0) * 10000) / 10000,
    recommendations: recommendations(state), actions: EMPTY_ARRAY
  });
}
