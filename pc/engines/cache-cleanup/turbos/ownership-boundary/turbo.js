/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Cache-cleanup ownership-boundary turbo. It classifies explicit ownership
 * evidence and never infers permission to remove or organize cache data.
 */

export const CACHE_OWNERSHIP_TURBO_ID = 'cache-cleanup.ownership-boundary';
export const CACHE_OWNERSHIP_TURBO_VERSION = 1;
export const CACHE_OWNERSHIP_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const OWNERSHIP = Object.freeze(['user-owned', 'system-safe', 'ambiguous']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ownershipOf(cache) {
  if (cache.userOwned === true) return 'user-owned';
  if (cache.systemOwned === true && cache.safe === true) return 'system-safe';
  return 'ambiguous';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Cache-cleanup ownership-boundary snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Cache-cleanup ownership-boundary requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.caches)) {
    throw new TypeError('Cache-cleanup ownership-boundary snapshot requires a cache list');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.caches.filter(isRecord);
  const ownership = rows.map(ownershipOf);
  return Object.freeze({
    environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    ownership: Object.freeze(ownership),
    userOwnedCount: ownership.filter((item) => item === 'user-owned').length,
    systemSafeCount: ownership.filter((item) => item === 'system-safe').length,
    ambiguousCount: ownership.filter((item) => item === 'ambiguous').length,
    cacheCount: rows.length
  });
}

function requireTrigger(trigger) {
  if (!CACHE_OWNERSHIP_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported cache-cleanup ownership-boundary trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Cache-cleanup ownership-boundary windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Cache-cleanup ownership-boundary minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(name, value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) {
    throw new RangeError(`Cache-cleanup ownership-boundary ${name} must be an integer from 1 to ${windowSize}`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Cache-cleanup ownership-boundary clock must return a number');
  }
  return timestamp;
}

function comparison(previous, current) {
  return Object.freeze({
    changed: previous.ownership.join('|') !== current.ownership.join('|')
      || previous.cacheCount !== current.cacheCount,
    userOwnedChanged: previous.userOwnedCount !== current.userOwnedCount,
    systemSafeChanged: previous.systemSafeCount !== current.systemSafeCount,
    ambiguousChanged: previous.ambiguousCount !== current.ambiguousCount
  });
}

function stateFor(sampleCount, minimumSamples, userOwnedCount, ambiguousCount,
  changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (userOwnedCount > 0) return 'user-owned-present';
  if (ambiguousCount > 0) return 'ambiguous-review';
  if (changeCount >= persistenceThreshold) return 'ownership-drift-sustained';
  if (changeCount > 0) return 'ownership-drift-observed';
  return 'stable-ownership';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-ownership-samples']);
  if (state === 'user-owned-present') return Object.freeze(['preserve-user-owned-cache-boundary']);
  if (state === 'ambiguous-review') return Object.freeze(['review-ambiguous-cache-ownership']);
  if (state === 'ownership-drift-sustained') return Object.freeze(['review-ownership-drift-without-file-mutation']);
  if (state === 'ownership-drift-observed') return Object.freeze(['observe-cache-ownership-stability']);
  return Object.freeze(['preview-safe-cache-candidates']);
}

function confidence(sampleCount, knownCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleWeight = Math.min(1, sampleCount / minimumSamples);
  return Math.round((knownCount / Math.max(1, knownCount + 1)) * sampleWeight * 10000) / 10000;
}

export function runCacheOwnershipBoundaryTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Cache-cleanup ownership-boundary samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold('persistenceThreshold', persistenceThreshold, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const changes = evidence.slice(1).map((current, index) => comparison(evidence[index], current));
  const latest = evidence.at(-1);
  const changeCount = changes.filter((item) => item.changed).length;
  const state = stateFor(selected.length, requiredSamples, latest?.userOwnedCount || 0,
    latest?.ambiguousCount || 0, changeCount, requiredPersistence);
  const knownCount = (latest?.userOwnedCount || 0) + (latest?.systemSafeCount || 0);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CACHE_OWNERSHIP_TURBO_ID,
    turboVersion: CACHE_OWNERSHIP_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    cacheCount: latest?.cacheCount || 0,
    userOwnedCount: latest?.userOwnedCount || 0,
    systemSafeCount: latest?.systemSafeCount || 0,
    ambiguousCount: latest?.ambiguousCount || 0,
    knownCount,
    comparisonCount: changes.length,
    changeCount,
    userOwnedChangeCount: changes.filter((item) => item.userOwnedChanged).length,
    systemSafeChangeCount: changes.filter((item) => item.systemSafeChanged).length,
    ambiguousChangeCount: changes.filter((item) => item.ambiguousChanged).length,
    finalEnvironment: latest?.environment || 'unknown',
    state,
    confidence: confidence(selected.length, knownCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
