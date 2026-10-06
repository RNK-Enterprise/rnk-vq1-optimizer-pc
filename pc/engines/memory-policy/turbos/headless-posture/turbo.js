/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Memory-policy headless-posture turbo. It compares environment-specific
 * policy posture without changing policy, reclaiming memory, or opening transport.
 */

export const MEMORY_POLICY_HEADLESS_POSTURE_TURBO_ID = 'memory-policy.headless-posture';
export const MEMORY_POLICY_HEADLESS_POSTURE_TURBO_VERSION = 1;
export const MEMORY_POLICY_HEADLESS_POSTURE_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const POLICIES = Object.freeze(['balanced', 'background-low', 'hold-current']);

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

function policyOf(value) {
  return POLICIES.includes(value) ? value : null;
}

function pressureFor(used, swap) {
  if (used === null && swap === null) return 'unknown';
  if ((used !== null && used >= 90) || (swap !== null && swap >= 75)) return 'high';
  if ((used !== null && used >= 75) || (swap !== null && swap >= 40)) return 'elevated';
  return 'normal';
}

function expectedPolicy(environment, pressure) {
  if (environment === 'unknown' || pressure === 'high' || pressure === 'unknown') return 'hold-current';
  if (pressure === 'elevated') return 'background-low';
  return 'balanced';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('Memory-policy headless-posture snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Memory-policy headless-posture requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.memory)) {
    throw new TypeError('Memory-policy headless-posture snapshot requires a memory section');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const used = percentOf(source.memory.usedPercent);
  const swap = percentOf(source.memory.swapUsedPercent);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const observedPolicy = policyOf(source.memory.currentPolicy);
  const pressure = pressureFor(used.value, swap.value);
  const expected = expectedPolicy(environment, pressure);
  const invalid = used.invalid || swap.invalid
    || (source.memory.currentPolicy !== undefined && observedPolicy === null);
  const postureObserved = observedPolicy !== null;
  const mismatch = postureObserved && observedPolicy !== expected;
  const headlessGap = mismatch && environment === 'headless';
  const interactiveGap = mismatch && environment === 'interactive';
  return Object.freeze({
    environment,
    pressure,
    observedPolicy,
    expectedPolicy: expected,
    postureObserved,
    mismatch,
    headlessGap,
    interactiveGap,
    invalid
  });
}

function requireTrigger(trigger) {
  if (!MEMORY_POLICY_HEADLESS_POSTURE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported memory-policy headless-posture trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Memory-policy headless-posture windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Memory-policy headless-posture minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Memory-policy headless-posture ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => item.postureObserved && !item.invalid);
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  headlessGapCount, interactiveGapCount, unknownEnvironmentCount,
  gapThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-posture-evidence';
  if (observedCount === 0) return 'no-observation';
  if (unknownEnvironmentCount > 0) return 'profile-required';
  if (headlessGapCount >= gapThreshold) return 'headless-protection-gap';
  if (interactiveGapCount >= gapThreshold) return 'interactive-policy-gap';
  return 'aligned-posture';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-posture-samples']);
  if (state === 'invalid-posture-evidence') return Object.freeze(['review-memory-policy-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-memory-policy-observation']);
  if (state === 'profile-required') return Object.freeze(['request-environment-profile']);
  if (state === 'headless-protection-gap') return Object.freeze(['hold-headless-policy-automation', 'review-service-protection']);
  if (state === 'interactive-policy-gap') return Object.freeze(['review-interactive-memory-policy']);
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
    throw new TypeError('Memory-policy headless-posture clock must return a number');
  }
  return timestamp;
}

export function runMemoryPolicyHeadlessPostureTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  gapThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('Memory-policy headless-posture samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredGap = requireCount('gapThreshold', gapThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const headlessGapCount = evidence.filter((item) => item.headlessGap).length;
  const interactiveGapCount = evidence.filter((item) => item.interactiveGap).length;
  const unknownEnvironmentCount = evidence.filter((item) => item.environment === 'unknown').length;
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    headlessGapCount, interactiveGapCount, unknownEnvironmentCount, requiredGap);
  return Object.freeze({
    protocolVersion: 1,
    turbo: MEMORY_POLICY_HEADLESS_POSTURE_TURBO_ID,
    turboVersion: MEMORY_POLICY_HEADLESS_POSTURE_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount,
    invalidCount,
    headlessGapCount,
    interactiveGapCount,
    unknownEnvironmentCount,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
