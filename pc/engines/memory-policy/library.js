/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Memory-policy library. It recommends a review posture from RAM and swap
 * evidence without changing swappiness, reclaiming memory, or editing files.
 */

export const MEMORY_POLICY_LIBRARY_ID = 'memory-policy-library';
export const MEMORY_POLICY_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Memory-policy library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Memory-policy library requires normalized system facts');
  }
  if (!isRecord(facts.memory)) throw new TypeError('Memory-policy library requires memory facts');
  return facts;
}

function pressureFor(usedPercent, swapUsedPercent) {
  if (usedPercent === null && swapUsedPercent === null) return 'unknown';
  if ((usedPercent !== null && usedPercent >= 90)
    || (swapUsedPercent !== null && swapUsedPercent >= 75)) return 'high';
  if ((usedPercent !== null && usedPercent >= 75)
    || (swapUsedPercent !== null && swapUsedPercent >= 40)) return 'elevated';
  return 'normal';
}

function policyFor(environment, pressure) {
  if (environment === 'unknown' || pressure === 'high' || pressure === 'unknown') {
    return 'hold-current';
  }
  if (pressure === 'elevated') return 'background-low';
  return 'balanced';
}

function recommendations(environment, pressure) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (pressure === 'unknown') return Object.freeze(['request-memory-observation']);
  if (pressure === 'high') return Object.freeze(['hold-current-memory-policy', 'hold-destructive-actions']);
  if (pressure === 'elevated') return Object.freeze(['review-background-low-policy', 'require-explicit-consent']);
  return Object.freeze(['no-change']);
}

export function classifyMemoryPolicy(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const usedPercent = percent(source.memory.usedPercent);
  const swapUsedPercent = percent(source.memory.swapUsedPercent);
  const pressure = pressureFor(usedPercent, swapUsedPercent);
  return Object.freeze({
    library: MEMORY_POLICY_LIBRARY_ID,
    libraryVersion: MEMORY_POLICY_LIBRARY_VERSION,
    environment,
    usedPercent,
    swapUsedPercent,
    pressure,
    policy: policyFor(environment, pressure),
    recommendations: recommendations(environment, pressure)
  });
}

export function compareMemoryPolicy(previous, current) {
  const before = classifyMemoryPolicy(previous);
  const after = classifyMemoryPolicy(current);
  const policyChanged = before.policy !== after.policy;
  const pressureChanged = before.pressure !== after.pressure;
  const swapChanged = before.swapUsedPercent !== after.swapUsedPercent;
  return Object.freeze({
    changed: policyChanged || pressureChanged || swapChanged,
    policyChanged,
    pressureChanged,
    swapChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Memory-policy library clock must return a number');
  return timestamp;
}

export function buildMemoryPolicyEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Memory-policy library trigger is required');
  }
  return Object.freeze({
    library: MEMORY_POLICY_LIBRARY_ID,
    libraryVersion: MEMORY_POLICY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyMemoryPolicy(facts)
  });
}

export function createMemoryPolicyLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Memory-policy library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: MEMORY_POLICY_LIBRARY_ID,
    version: MEMORY_POLICY_LIBRARY_VERSION,
    classify: classifyMemoryPolicy,
    compare: compareMemoryPolicy,
    envelope: (facts, envelopeOptions = {}) => buildMemoryPolicyEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
