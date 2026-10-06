/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Swap library. It classifies swap availability and pressure for review only;
 * it never creates swap, changes swappiness, or edits the filesystem.
 */

export const SWAP_LIBRARY_ID = 'swap-library';
export const SWAP_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Swap library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Swap library requires normalized system facts');
  }
  if (!isRecord(facts.memory)) throw new TypeError('Swap library requires memory facts');
  return facts;
}

function stateFor(totalBytes, usedPercent) {
  if (totalBytes === 0) return 'none';
  if (totalBytes === null || usedPercent === null) return 'unknown';
  if (usedPercent >= 75) return 'high';
  if (usedPercent >= 40) return 'elevated';
  return 'normal';
}

function recommendations(environment, state) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (state === 'unknown') return Object.freeze(['request-swap-observation']);
  if (state === 'none') return Object.freeze(['no-change', 'keep-no-swap-user-owned']);
  if (state === 'high') return Object.freeze(['hold-destructive-actions', 'review-memory-pressure']);
  if (state === 'elevated') return Object.freeze(['observe-next-sample', 'review-documented-swap-policy']);
  return Object.freeze(['no-change']);
}

export function classifySwap(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const totalBytes = nonNegative(source.memory.swapTotalBytes);
  const freeBytes = nonNegative(source.memory.swapFreeBytes);
  const usedPercent = percent(source.memory.swapUsedPercent);
  const state = stateFor(totalBytes, usedPercent);
  return Object.freeze({
    library: SWAP_LIBRARY_ID,
    libraryVersion: SWAP_LIBRARY_VERSION,
    environment,
    totalBytes,
    freeBytes,
    usedPercent,
    state,
    recommendations: recommendations(environment, state)
  });
}

export function compareSwap(previous, current) {
  const before = classifySwap(previous);
  const after = classifySwap(current);
  const stateChanged = before.state !== after.state;
  const usedChanged = before.usedPercent !== after.usedPercent;
  const totalChanged = before.totalBytes !== after.totalBytes;
  return Object.freeze({
    changed: stateChanged || usedChanged || totalChanged,
    stateChanged,
    usedChanged,
    totalChanged,
    freeDelta: before.freeBytes === null || after.freeBytes === null
      ? null : after.freeBytes - before.freeBytes
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Swap library clock must return a number');
  return timestamp;
}

export function buildSwapEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Swap library trigger is required');
  }
  return Object.freeze({
    library: SWAP_LIBRARY_ID,
    libraryVersion: SWAP_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifySwap(facts)
  });
}

export function createSwapLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Swap library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: SWAP_LIBRARY_ID,
    version: SWAP_LIBRARY_VERSION,
    classify: classifySwap,
    compare: compareSwap,
    envelope: (facts, envelopeOptions = {}) => buildSwapEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
