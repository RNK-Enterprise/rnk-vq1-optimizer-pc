/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Cache-cleanup evidence-completeness turbo. It measures whether explicit
 * cache metadata is complete enough for preview review, without reading paths.
 */

export const CACHE_EVIDENCE_TURBO_ID = 'cache-cleanup.evidence-completeness';
export const CACHE_EVIDENCE_TURBO_VERSION = 1;
export const CACHE_EVIDENCE_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function completeOf(cache) {
  const named = typeof cache.name === 'string' && cache.name.trim().length > 0;
  const sized = Number.isFinite(cache.sizeBytes) && cache.sizeBytes >= 0;
  const ownership = typeof cache.systemOwned === 'boolean' && typeof cache.userOwned === 'boolean';
  const safety = typeof cache.safe === 'boolean';
  return named && sized && ownership && safety;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Cache-cleanup evidence-completeness snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Cache-cleanup evidence-completeness requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.caches)) {
    throw new TypeError('Cache-cleanup evidence-completeness snapshot requires a cache list');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.caches.filter(isRecord);
  const complete = rows.filter(completeOf).length;
  return Object.freeze({
    environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    cacheCount: rows.length,
    completeCount: complete,
    incompleteCount: rows.length - complete,
    completeness: rows.length === 0 ? 0 : complete / rows.length
  });
}

function requireTrigger(trigger) {
  if (!CACHE_EVIDENCE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported cache-cleanup evidence-completeness trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Cache-cleanup evidence-completeness windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Cache-cleanup evidence-completeness minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(name, value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) {
    throw new RangeError(`Cache-cleanup evidence-completeness ${name} must be an integer from 1 to ${windowSize}`);
  }
  return value;
}

function requireRatio(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('Cache-cleanup evidence-completeness minimumCompleteness must be between 0 and 1');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Cache-cleanup evidence-completeness clock must return a number');
  }
  return timestamp;
}

function comparison(previous, current, minimumCompleteness) {
  return Object.freeze({
    changed: (previous.completeness >= minimumCompleteness)
      !== (current.completeness >= minimumCompleteness),
    completenessChanged: previous.completeness !== current.completeness,
    incompleteChanged: previous.incompleteCount !== current.incompleteCount
  });
}

function stateFor(sampleCount, minimumSamples, cacheCount, incompleteCount,
  completeness, changeCount, persistenceThreshold, minimumCompleteness) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (cacheCount === 0) return 'no-cache-evidence';
  if (incompleteCount > 0 || completeness < minimumCompleteness) return 'incomplete-evidence';
  if (changeCount >= persistenceThreshold) return 'evidence-drift-sustained';
  if (changeCount > 0) return 'evidence-drift-observed';
  return 'complete-evidence';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cache-evidence-samples']);
  if (state === 'no-cache-evidence') return Object.freeze(['no-cache-cleanup-review']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-complete-cache-metadata']);
  if (state === 'evidence-drift-sustained') return Object.freeze(['review-cache-evidence-drift']);
  if (state === 'evidence-drift-observed') return Object.freeze(['observe-cache-evidence-stability']);
  return Object.freeze(['preview-safe-cache-candidates']);
}

function confidence(sampleCount, completeness, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round(completeness * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}

export function runCacheEvidenceCompletenessTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  minimumCompleteness = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Cache-cleanup evidence-completeness samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold('persistenceThreshold', persistenceThreshold, boundedWindow);
  const requiredCompleteness = requireRatio(minimumCompleteness);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const changes = evidence.slice(1).map((current, index) => comparison(evidence[index], current, requiredCompleteness));
  const latest = evidence.at(-1);
  const changeCount = changes.filter((item) => item.changed).length;
  const state = stateFor(selected.length, requiredSamples, latest?.cacheCount || 0,
    latest?.incompleteCount || 0, latest?.completeness || 0, changeCount,
    requiredPersistence, requiredCompleteness);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CACHE_EVIDENCE_TURBO_ID,
    turboVersion: CACHE_EVIDENCE_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    minimumCompleteness: requiredCompleteness,
    cacheCount: latest?.cacheCount || 0,
    completeCount: latest?.completeCount || 0,
    incompleteCount: latest?.incompleteCount || 0,
    completeness: latest?.completeness || 0,
    comparisonCount: changes.length,
    changeCount,
    completenessChangeCount: changes.filter((item) => item.completenessChanged).length,
    incompleteChangeCount: changes.filter((item) => item.incompleteChanged).length,
    finalEnvironment: latest?.environment || 'unknown',
    state,
    confidence: confidence(selected.length, latest?.completeness || 0, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
