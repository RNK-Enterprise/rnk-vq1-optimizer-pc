/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Cache-cleanup candidate-drift turbo. It compares explicitly named,
 * system-owned, safe candidates without reading, deleting, or moving files.
 */

export const CACHE_CANDIDATE_DRIFT_TURBO_ID = 'cache-cleanup.candidate-drift';
export const CACHE_CANDIDATE_DRIFT_TURBO_VERSION = 1;
export const CACHE_CANDIDATE_DRIFT_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sizeOf(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function candidateOf(cache) {
  if (cache.userOwned === true || cache.safe !== true || cache.systemOwned !== true) return null;
  const name = text(cache.name);
  if (name === null) return null;
  return Object.freeze({ name, sizeBytes: sizeOf(cache.sizeBytes) });
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Cache-cleanup candidate-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Cache-cleanup candidate-drift requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.caches)) {
    throw new TypeError('Cache-cleanup candidate-drift snapshot requires a cache list');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.caches.filter(isRecord);
  const candidates = rows.map(candidateOf).filter(Boolean);
  const reviewCount = rows.length - candidates.length;
  const named = candidates.filter((candidate) => candidate.sizeBytes !== null);
  return Object.freeze({
    environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    candidates: Object.freeze(candidates),
    names: Object.freeze(candidates.map((candidate) => candidate.name)),
    candidateCount: candidates.length,
    namedCount: named.length,
    candidateBytes: named.reduce((sum, candidate) => sum + candidate.sizeBytes, 0),
    reviewCount
  });
}

function requireTrigger(trigger) {
  if (!CACHE_CANDIDATE_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported cache-cleanup candidate-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Cache-cleanup candidate-drift windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Cache-cleanup candidate-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(name, value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) {
    throw new RangeError(`Cache-cleanup candidate-drift ${name} must be an integer from 1 to ${windowSize}`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Cache-cleanup candidate-drift clock must return a number');
  }
  return timestamp;
}

function changed(previous, current) {
  const before = new Map(previous.candidates.map((candidate) => [candidate.name, candidate.sizeBytes]));
  const after = new Map(current.candidates.map((candidate) => [candidate.name, candidate.sizeBytes]));
  const addedCount = current.names.filter((name) => !before.has(name)).length;
  const removedCount = previous.names.filter((name) => !after.has(name)).length;
  const sizeChanged = current.names.filter((name) => before.has(name)
    && before.get(name) !== after.get(name)).length;
  return Object.freeze({
    changed: addedCount > 0 || removedCount > 0 || sizeChanged > 0,
    addedCount,
    removedCount,
    sizeChanged
  });
}

function stateFor(sampleCount, minimumSamples, candidateCount, reviewCount,
  changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (candidateCount === 0 && reviewCount === 0) return 'no-candidates';
  if (reviewCount > 0) return 'review-required';
  if (changeCount >= persistenceThreshold) return 'candidate-drift-sustained';
  if (changeCount > 0) return 'candidate-drift-observed';
  return 'stable-preview';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-candidate-samples']);
  if (state === 'no-candidates') return Object.freeze(['no-cache-cleanup-review']);
  if (state === 'review-required') return Object.freeze(['review-cache-ownership']);
  if (state === 'candidate-drift-sustained') return Object.freeze(['review-candidate-drift-without-file-mutation']);
  if (state === 'candidate-drift-observed') return Object.freeze(['observe-candidate-stability']);
  return Object.freeze(['preview-safe-cache-candidates']);
}

function confidence(sampleCount, candidateCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleWeight = Math.min(1, sampleCount / minimumSamples);
  const candidateWeight = candidateCount > 0 ? 1 : 0.5;
  return Math.round(sampleWeight * candidateWeight * 10000) / 10000;
}

export function runCacheCandidateDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Cache-cleanup candidate-drift samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold('persistenceThreshold', persistenceThreshold, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const changes = evidence.slice(1).map((current, index) => changed(evidence[index], current));
  const candidateCount = evidence.at(-1)?.candidateCount || 0;
  const reviewCount = evidence.reduce((sum, item) => sum + item.reviewCount, 0);
  const changeCount = changes.filter((item) => item.changed).length;
  const state = stateFor(selected.length, requiredSamples, candidateCount, reviewCount,
    changeCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CACHE_CANDIDATE_DRIFT_TURBO_ID,
    turboVersion: CACHE_CANDIDATE_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    candidateCount,
    namedCandidateCount: evidence.at(-1)?.namedCount || 0,
    candidateBytes: evidence.at(-1)?.candidateBytes || 0,
    reviewCount,
    comparisonCount: changes.length,
    changeCount,
    addedCount: changes.reduce((sum, item) => sum + item.addedCount, 0),
    removedCount: changes.reduce((sum, item) => sum + item.removedCount, 0),
    sizeChangeCount: changes.reduce((sum, item) => sum + item.sizeChanged, 0),
    finalEnvironment: evidence.at(-1)?.environment || 'unknown',
    state,
    confidence: confidence(selected.length, candidateCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
