/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Temp-cleanup library. It classifies bounded temporary-file observations for
 * review and never reads paths, deletes files, or changes storage policy.
 */

export const TEMP_CLEANUP_LIBRARY_ID = 'temp-cleanup-library';
export const TEMP_CLEANUP_LIBRARY_VERSION = 1;

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

function disposition(item) {
  if (item.userOwned === true) return 'user-owned';
  if (item.temporary !== true || item.systemOwned !== true) return 'review';
  return 'safe-candidate';
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Temp-cleanup library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Temp-cleanup library requires normalized system facts');
  }
  if (!Array.isArray(facts.temporaryFiles)) {
    throw new TypeError('Temp-cleanup library requires a temporary-file list');
  }
  return facts;
}

function sum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0);
}

function stateFor(environment, count, reviewCount) {
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

export function classifyTempCleanup(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const temporaryFiles = source.temporaryFiles.filter(isRecord).map((item) => ({
    name: text(item.name),
    sizeBytes: nonNegative(item.sizeBytes),
    disposition: disposition(item)
  }));
  const safeCandidates = temporaryFiles.filter((item) => item.disposition === 'safe-candidate');
  const reviewCount = temporaryFiles.filter((item) => item.disposition !== 'safe-candidate').length;
  const completeCount = temporaryFiles.filter((item) => item.name !== null && item.sizeBytes !== null).length;
  return Object.freeze({
    library: TEMP_CLEANUP_LIBRARY_ID,
    libraryVersion: TEMP_CLEANUP_LIBRARY_VERSION,
    environment,
    temporaryFileCount: temporaryFiles.length,
    names: Object.freeze(temporaryFiles.map((item) => item.name).filter(Boolean)),
    safeCandidateCount: safeCandidates.length,
    safeCandidateBytes: sum(safeCandidates, (item) => item.sizeBytes),
    reviewCount,
    completeCount,
    state: stateFor(environment, temporaryFiles.length, reviewCount),
    confidence: confidence(environment, temporaryFiles.length, completeCount),
    recommendations: recommendations(environment, temporaryFiles.length, reviewCount)
  });
}

export function compareTempCleanup(previous, current) {
  const before = classifyTempCleanup(previous);
  const after = classifyTempCleanup(current);
  const stateChanged = before.state !== after.state;
  const countChanged = before.temporaryFileCount !== after.temporaryFileCount;
  const candidateCountChanged = before.safeCandidateCount !== after.safeCandidateCount;
  const candidateBytesChanged = before.safeCandidateBytes !== after.safeCandidateBytes;
  const reviewChanged = before.reviewCount !== after.reviewCount;
  return Object.freeze({
    changed: stateChanged || countChanged || candidateCountChanged || candidateBytesChanged || reviewChanged,
    stateChanged,
    countChanged,
    candidateCountChanged,
    candidateBytesChanged,
    reviewChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Temp-cleanup library clock must return a number');
  return timestamp;
}

export function buildTempCleanupEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Temp-cleanup library trigger is required');
  }
  return Object.freeze({
    library: TEMP_CLEANUP_LIBRARY_ID,
    libraryVersion: TEMP_CLEANUP_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyTempCleanup(facts)
  });
}

export function createTempCleanupLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Temp-cleanup library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: TEMP_CLEANUP_LIBRARY_ID,
    version: TEMP_CLEANUP_LIBRARY_VERSION,
    classify: classifyTempCleanup,
    compare: compareTempCleanup,
    envelope: (facts, envelopeOptions = {}) => buildTempCleanupEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
