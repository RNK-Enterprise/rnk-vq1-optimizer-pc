/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Cache-cleanup size-trend turbo. It compares explicit cache-size metadata
 * without reading paths or making any deletion decision.
 */

export const CACHE_SIZE_TREND_TURBO_ID = 'cache-cleanup.size-trend';
export const CACHE_SIZE_TREND_TURBO_VERSION = 1;
export const CACHE_SIZE_TREND_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sizeOf(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Cache-cleanup size-trend snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Cache-cleanup size-trend requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.caches)) {
    throw new TypeError('Cache-cleanup size-trend snapshot requires a cache list');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.caches.filter(isRecord);
  const sizes = rows.map((row) => sizeOf(row.sizeBytes));
  const known = sizes.filter((size) => size !== null);
  return Object.freeze({
    environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    cacheCount: rows.length,
    knownCount: known.length,
    invalidSizeCount: sizes.length - known.length,
    totalBytes: known.reduce((sum, size) => sum + size, 0)
  });
}

function requireTrigger(trigger) {
  if (!CACHE_SIZE_TREND_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported cache-cleanup size-trend trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Cache-cleanup size-trend windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Cache-cleanup size-trend minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(name, value, upper) {
  if (!Number.isInteger(value) || value < 1 || value > upper) {
    throw new RangeError(`Cache-cleanup size-trend ${name} must be an integer from 1 to ${upper}`);
  }
  return value;
}

function requireBytes(value) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Cache-cleanup size-trend minimumDeltaBytes must be a safe non-negative number');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Cache-cleanup size-trend clock must return a number');
  }
  return timestamp;
}

function comparison(previous, current, minimumDeltaBytes) {
  const deltaBytes = current.totalBytes - previous.totalBytes;
  return Object.freeze({
    changed: Math.abs(deltaBytes) >= minimumDeltaBytes,
    deltaBytes,
    increase: deltaBytes >= minimumDeltaBytes,
    decrease: deltaBytes <= -minimumDeltaBytes
  });
}

function stateFor(sampleCount, minimumSamples, knownCount, invalidSizeCount,
  changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (knownCount === 0) return 'no-size-observation';
  if (invalidSizeCount > 0) return 'invalid-size-evidence';
  if (changeCount >= persistenceThreshold) return 'size-drift-sustained';
  if (changeCount > 0) return 'size-drift-observed';
  return 'stable-size';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-size-samples']);
  if (state === 'no-size-observation') return Object.freeze(['request-cache-size-observation']);
  if (state === 'invalid-size-evidence') return Object.freeze(['review-cache-size-evidence']);
  if (state === 'size-drift-sustained') return Object.freeze(['review-cache-size-trend-without-file-mutation']);
  if (state === 'size-drift-observed') return Object.freeze(['observe-cache-size-stability']);
  return Object.freeze(['preview-safe-cache-candidates']);
}

function confidence(sampleCount, knownCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleWeight = Math.min(1, sampleCount / minimumSamples);
  return Math.round((knownCount / Math.max(1, knownCount)) * sampleWeight * 10000) / 10000;
}

export function runCacheSizeTrendTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  minimumDeltaBytes = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Cache-cleanup size-trend samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold('persistenceThreshold', persistenceThreshold, boundedWindow);
  const requiredDelta = requireBytes(minimumDeltaBytes);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const changes = evidence.slice(1).map((current, index) => comparison(evidence[index], current, requiredDelta));
  const latest = evidence.at(-1);
  const changeCount = changes.filter((item) => item.changed).length;
  const state = stateFor(selected.length, requiredSamples, latest?.knownCount || 0,
    latest?.invalidSizeCount || 0, changeCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CACHE_SIZE_TREND_TURBO_ID,
    turboVersion: CACHE_SIZE_TREND_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    minimumDeltaBytes: requiredDelta,
    cacheCount: latest?.cacheCount || 0,
    knownCount: latest?.knownCount || 0,
    invalidSizeCount: latest?.invalidSizeCount || 0,
    totalBytes: latest?.totalBytes || 0,
    comparisonCount: changes.length,
    changeCount,
    increaseCount: changes.filter((item) => item.increase).length,
    decreaseCount: changes.filter((item) => item.decrease).length,
    deltaBytes: changes.at(-1)?.deltaBytes || 0,
    finalEnvironment: latest?.environment || 'unknown',
    state,
    confidence: confidence(selected.length, latest?.knownCount || 0, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
