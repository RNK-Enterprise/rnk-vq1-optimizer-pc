/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Swap engine. It distinguishes absent, normal, elevated, high, and unknown
 * swap evidence without creating swap, changing swappiness, touching files,
 * or opening transport.
 */

export const SWAP_ENGINE_ID = 'swap';
export const SWAP_ENGINE_VERSION = 1;
export const SWAP_TRIGGERS = Object.freeze([
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

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Swap facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Swap requires system-facts facts');
  if (!isRecord(facts.memory)) throw new TypeError('Swap facts require a memory section');
  return facts;
}

function requireTrigger(trigger) {
  if (!SWAP_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported swap trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Swap clock must return a number');
  return timestamp;
}

function swapState(totalBytes, usedPercent) {
  if (totalBytes === 0) return 'none';
  if (totalBytes === null || usedPercent === null) return 'unknown';
  if (usedPercent >= 75) return 'high';
  if (usedPercent >= 40) return 'elevated';
  return 'normal';
}

function operatingState(environment, state) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'unknown') return 'observation-required';
  if (state === 'high') return 'hold-destructive-actions';
  if (state === 'elevated') return 'review';
  if (state === 'none') return 'observe-no-swap';
  return 'observe';
}

function recommendations(environment, state) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (state === 'unknown') return Object.freeze(['request-swap-observation']);
  if (state === 'none') return Object.freeze(['no-change', 'keep-no-swap-user-owned']);
  if (state === 'high') return Object.freeze(['hold-destructive-actions', 'review-memory-pressure']);
  if (state === 'elevated') return Object.freeze(['observe-next-sample', 'review-documented-swap-policy']);
  return Object.freeze(['no-change']);
}

function confidence(environment, totalBytes, usedPercent, freeBytes) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (totalBytes !== null) score += 0.35;
  if (usedPercent !== null) score += 0.3;
  if (freeBytes !== null) score += 0.15;
  return Math.round(score * 10000) / 10000;
}

export function runSwapEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const totalBytes = nonNegative(source.memory.swapTotalBytes);
  const freeBytes = nonNegative(source.memory.swapFreeBytes);
  const usedPercent = percent(source.memory.swapUsedPercent);
  const state = swapState(totalBytes, usedPercent);
  return Object.freeze({
    protocolVersion: 1,
    engine: SWAP_ENGINE_ID,
    engineVersion: SWAP_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    totalBytes,
    freeBytes,
    usedPercent,
    state,
    operatingState: operatingState(environment, state),
    confidence: confidence(environment, totalBytes, usedPercent, freeBytes),
    recommendations: recommendations(environment, state),
    actions: EMPTY_ARRAY
  });
}
