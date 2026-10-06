/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Memory-pressure engine. It classifies normalized RAM pressure and headroom
 * without reclaiming memory, clearing caches, touching files, or opening
 * transport.
 */

export const MEMORY_PRESSURE_ENGINE_ID = 'memory-pressure';
export const MEMORY_PRESSURE_ENGINE_VERSION = 1;
export const MEMORY_PRESSURE_TRIGGERS = Object.freeze([
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

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Memory-pressure facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Memory-pressure requires system-facts facts');
  if (!isRecord(facts.memory)) throw new TypeError('Memory-pressure facts require a memory section');
  return facts;
}

function requireTrigger(trigger) {
  if (!MEMORY_PRESSURE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported memory-pressure trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Memory-pressure clock must return a number');
  return timestamp;
}

function levelFor(usedPercent) {
  if (usedPercent === null) return 'unknown';
  if (usedPercent >= 90) return 'high';
  if (usedPercent >= 75) return 'elevated';
  return 'normal';
}

function operatingState(environment, level) {
  if (environment === 'unknown') return 'profile-required';
  if (level === 'unknown') return 'observation-required';
  if (level === 'high' && environment === 'headless') return 'protect-services';
  if (level === 'high') return 'protect-foreground';
  if (level === 'elevated') return 'watch';
  return 'observe';
}

function recommendations(environment, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (level === 'unknown') return Object.freeze(['request-memory-observation']);
  if (level === 'high' && environment === 'headless') {
    return Object.freeze(['protect-services', 'hold-destructive-actions']);
  }
  if (level === 'high') return Object.freeze(['protect-foreground', 'hold-destructive-actions']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample', 'review-approved-memory-policy']);
  return Object.freeze(['no-change']);
}

function confidence(environment, usedPercent, totalBytes, availableBytes, swapUsedPercent) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (usedPercent !== null) score += 0.35;
  if (totalBytes !== null) score += 0.2;
  if (availableBytes !== null) score += 0.15;
  if (swapUsedPercent !== null) score += 0.1;
  return Math.round(score * 10000) / 10000;
}

export function runMemoryPressureEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const usedPercent = percent(source.memory.usedPercent);
  const totalBytes = nonNegative(source.memory.totalBytes);
  const availableBytes = nonNegative(source.memory.availableBytes);
  const swapUsedPercent = percent(source.memory.swapUsedPercent);
  const level = levelFor(usedPercent);
  const state = operatingState(environment, level);
  return Object.freeze({
    protocolVersion: 1,
    engine: MEMORY_PRESSURE_ENGINE_ID,
    engineVersion: MEMORY_PRESSURE_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    usedPercent,
    headroomPercent: usedPercent === null ? null : Math.round((100 - usedPercent) * 100) / 100,
    totalBytes,
    availableBytes,
    swapUsedPercent,
    level,
    state,
    confidence: confidence(environment, usedPercent, totalBytes, availableBytes, swapUsedPercent),
    recommendations: recommendations(environment, level),
    actions: EMPTY_ARRAY
  });
}
