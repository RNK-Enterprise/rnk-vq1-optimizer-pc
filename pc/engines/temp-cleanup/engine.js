/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Temp-cleanup engine. It previews explicitly temporary, system-owned
 * candidates without reading paths, deleting files, or changing storage.
 */

export const TEMP_CLEANUP_ENGINE_ID = 'temp-cleanup';
export const TEMP_CLEANUP_ENGINE_VERSION = 1;
export const TEMP_CLEANUP_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
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

function disposition(item) {
  if (item.userOwned === true) return 'user-owned';
  if (item.temporary !== true || item.systemOwned !== true) return 'review';
  return 'safe-candidate';
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Temp-cleanup facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Temp-cleanup requires system-facts facts');
  if (!Array.isArray(facts.temporaryFiles)) throw new TypeError('Temp-cleanup facts require a temporary-file list');
  return facts;
}

function requireTrigger(trigger) {
  if (!TEMP_CLEANUP_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported temp-cleanup trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Temp-cleanup clock must return a number');
  return timestamp;
}

function operatingState(environment, count, reviewCount) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-temp-review';
  if (reviewCount > 0) return 'review-required';
  return 'preview-only';
}

function recommendations(environment, count, reviewCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-temp-cleanup-review']);
  if (reviewCount > 0) return Object.freeze(['review-temp-file-ownership']);
  return Object.freeze(['preview-safe-temp-candidates']);
}

function confidence(environment, count, completeCount) {
  let score = 0;
  if (environment !== 'unknown') score += 0.25;
  if (count > 0) score += 0.25;
  if (count > 0 && completeCount === count) score += 0.5;
  return Math.round(score * 10000) / 10000;
}

export function runTempCleanupEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const temporaryFiles = source.temporaryFiles.filter(isRecord).map((item) => ({
    name: text(item.name),
    sizeBytes: nonNegative(item.sizeBytes),
    disposition: disposition(item)
  }));
  const safeCandidates = temporaryFiles.filter((item) => item.disposition === 'safe-candidate');
  const reviewCount = temporaryFiles.filter((item) => item.disposition !== 'safe-candidate').length;
  const completeCount = temporaryFiles.filter((item) => item.name !== null && item.sizeBytes !== null).length;
  const safeBytes = safeCandidates
    .map((item) => item.sizeBytes)
    .filter((size) => size !== null)
    .reduce((total, size) => total + size, 0);
  return Object.freeze({
    protocolVersion: 1,
    engine: TEMP_CLEANUP_ENGINE_ID,
    engineVersion: TEMP_CLEANUP_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    temporaryFileCount: temporaryFiles.length,
    names: Object.freeze(temporaryFiles.map((item) => item.name).filter(Boolean)),
    safeCandidateCount: safeCandidates.length,
    safeCandidateBytes: safeBytes,
    reviewCount,
    completeCount,
    state: operatingState(environment, temporaryFiles.length, reviewCount),
    confidence: confidence(environment, temporaryFiles.length, completeCount),
    recommendations: recommendations(environment, temporaryFiles.length, reviewCount),
    actions: EMPTY_ARRAY
  });
}
