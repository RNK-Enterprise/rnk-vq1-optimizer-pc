/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Memory-policy pressure-policy-drift turbo. It observes bounded pressure and
 * policy transitions without changing policy, reclaiming memory, or opening transport.
 */

export const MEMORY_POLICY_PRESSURE_DRIFT_TURBO_ID = 'memory-policy.pressure-policy-drift';
export const MEMORY_POLICY_PRESSURE_DRIFT_TURBO_VERSION = 1;
export const MEMORY_POLICY_PRESSURE_DRIFT_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const PRESSURES = Object.freeze(['normal', 'elevated', 'high', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function percentOf(value) {
  if (!Number.isFinite(value)) return Object.freeze({ value: null, invalid: false });
  return Object.freeze({
    value: Math.min(100, Math.max(0, value)),
    invalid: value < 0 || value > 100
  });
}

function pressureFor(used, swap) {
  if (used === null && swap === null) return 'unknown';
  if ((used !== null && used >= 90) || (swap !== null && swap >= 75)) return 'high';
  if ((used !== null && used >= 75) || (swap !== null && swap >= 40)) return 'elevated';
  return 'normal';
}

function policyFor(environment, pressure) {
  if (environment === 'unknown' || pressure === 'high' || pressure === 'unknown') return 'hold-current';
  if (pressure === 'elevated') return 'background-low';
  return 'balanced';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('Memory-policy pressure-policy-drift snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Memory-policy pressure-policy-drift requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.memory)) {
    throw new TypeError('Memory-policy pressure-policy-drift snapshot requires a memory section');
  }
  return snapshot;
}

function postureOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const used = percentOf(source.memory.usedPercent);
  const swap = percentOf(source.memory.swapUsedPercent);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const pressure = pressureFor(used.value, swap.value);
  return Object.freeze({
    environment,
    usedPercent: used.value,
    swapUsedPercent: swap.value,
    pressure,
    policy: policyFor(environment, pressure),
    invalid: used.invalid || swap.invalid
  });
}

function requireTrigger(trigger) {
  if (!MEMORY_POLICY_PRESSURE_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported memory-policy pressure-policy-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Memory-policy pressure-policy-drift windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Memory-policy pressure-policy-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Memory-policy pressure-policy-drift ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => item.pressure !== 'unknown' && !item.invalid);
}

function rank(pressure) {
  return { normal: 0, elevated: 1, high: 2, unknown: -1 }[pressure];
}

function movement(evidence) {
  let policyChanges = 0;
  let escalationCount = 0;
  let recoveryCount = 0;
  let comparisons = 0;
  for (let index = 1; index < evidence.length; index += 1) {
    const previous = evidence[index - 1];
    const current = evidence[index];
    if (previous.pressure === 'unknown' || current.pressure === 'unknown'
      || previous.invalid || current.invalid) continue;
    comparisons += 1;
    if (previous.policy !== current.policy) policyChanges += 1;
    if (rank(current.pressure) > rank(previous.pressure)) escalationCount += 1;
    if (rank(current.pressure) < rank(previous.pressure)) recoveryCount += 1;
  }
  return { policyChanges, escalationCount, recoveryCount, comparisons };
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  policyChanges, escalationCount, recoveryCount, churnThreshold,
  escalationThreshold, recoveryThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-policy-evidence';
  if (observedCount === 0) return 'no-observation';
  if (policyChanges >= churnThreshold) return 'policy-churn';
  if (escalationCount >= escalationThreshold) return 'policy-escalation';
  if (recoveryCount >= recoveryThreshold) return 'policy-recovery';
  return 'stable-policy';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-policy-samples']);
  if (state === 'invalid-policy-evidence') return Object.freeze(['review-memory-policy-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-memory-policy-observation']);
  if (state === 'policy-churn') return Object.freeze(['hold-policy-automation', 'review-policy-transitions']);
  if (state === 'policy-escalation') return Object.freeze(['review-memory-pressure-escalation']);
  if (state === 'policy-recovery') return Object.freeze(['observe-memory-policy-recovery']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Memory-policy pressure-policy-drift clock must return a number');
  }
  return timestamp;
}

export function runMemoryPolicyPressurePolicyDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  churnThreshold = 2,
  escalationThreshold = 2,
  recoveryThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('Memory-policy pressure-policy-drift samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredChurn = requireCount('churnThreshold', churnThreshold);
  const requiredEscalation = requireCount('escalationThreshold', escalationThreshold);
  const requiredRecovery = requireCount('recoveryThreshold', recoveryThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(postureOf);
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const trend = movement(evidence);
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    trend.policyChanges, trend.escalationCount, trend.recoveryCount, requiredChurn,
    requiredEscalation, requiredRecovery);
  return Object.freeze({
    protocolVersion: 1,
    turbo: MEMORY_POLICY_PRESSURE_DRIFT_TURBO_ID,
    turboVersion: MEMORY_POLICY_PRESSURE_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount,
    invalidCount,
    policyChanges: trend.policyChanges,
    escalationCount: trend.escalationCount,
    recoveryCount: trend.recoveryCount,
    comparisonCount: trend.comparisons,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
