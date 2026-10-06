/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Memory-policy engine. It evaluates whether normalized RAM and swap evidence
 * supports a documented memory-policy review. It never changes policy,
 * reclaims memory, clears caches, or opens transport.
 */

export const MEMORY_POLICY_ENGINE_ID = 'memory-policy';
export const MEMORY_POLICY_ENGINE_VERSION = 1;
export const MEMORY_POLICY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const POLICIES = Object.freeze(['balanced', 'background-low', 'hold-current']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Memory-policy facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Memory-policy requires system-facts facts');
  if (!isRecord(facts.memory)) throw new TypeError('Memory-policy facts require a memory section');
  return facts;
}

function requireTrigger(trigger) {
  if (!MEMORY_POLICY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported memory-policy trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Memory-policy clock must return a number');
  return timestamp;
}

function pressureLevel(usedPercent, swapUsedPercent) {
  if (usedPercent === null && swapUsedPercent === null) return 'unknown';
  if ((usedPercent !== null && usedPercent >= 90) || (swapUsedPercent !== null && swapUsedPercent >= 75)) {
    return 'high';
  }
  if ((usedPercent !== null && usedPercent >= 75) || (swapUsedPercent !== null && swapUsedPercent >= 40)) {
    return 'elevated';
  }
  return 'normal';
}

function recommendedPolicy(environment, level) {
  if (environment === 'unknown') return 'hold-current';
  if (level === 'high') return 'hold-current';
  if (level === 'elevated') return 'background-low';
  return 'balanced';
}

function stateFor(environment, level) {
  if (environment === 'unknown') return 'profile-required';
  if (level === 'unknown') return 'observation-required';
  if (level === 'high') return 'hold-policy';
  if (level === 'elevated') return 'review-policy';
  return 'observe';
}

function recommendations(environment, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (level === 'unknown') return Object.freeze(['request-memory-observation']);
  if (level === 'high') return Object.freeze(['hold-current-memory-policy', 'hold-destructive-actions']);
  if (level === 'elevated') return Object.freeze(['review-background-low-policy', 'require-explicit-consent']);
  return Object.freeze(['no-change']);
}

function confidence(environment, usedPercent, swapUsedPercent) {
  let score = 0;
  if (environment !== 'unknown') score += 0.25;
  if (usedPercent !== null) score += 0.45;
  if (swapUsedPercent !== null) score += 0.3;
  return Math.round(score * 10000) / 10000;
}

export function runMemoryPolicyEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const usedPercent = percent(source.memory.usedPercent);
  const swapUsedPercent = percent(source.memory.swapUsedPercent);
  const level = pressureLevel(usedPercent, swapUsedPercent);
  const policy = recommendedPolicy(environment, level);
  const state = stateFor(environment, level);
  return Object.freeze({
    protocolVersion: 1,
    engine: MEMORY_POLICY_ENGINE_ID,
    engineVersion: MEMORY_POLICY_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    usedPercent,
    swapUsedPercent,
    pressure: level,
    policy,
    state,
    confidence: confidence(environment, usedPercent, swapUsedPercent),
    recommendations: recommendations(environment, level),
    actions: EMPTY_ARRAY
  });
}
