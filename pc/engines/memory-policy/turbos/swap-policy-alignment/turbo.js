/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Memory-policy swap-policy-alignment turbo. It compares swap pressure with
 * the observed policy without changing policy, reclaiming memory, or opening
 * transport.
 */

export const MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_TURBO_ID = 'memory-policy.swap-policy-alignment';
export const MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_TURBO_VERSION = 1;
export const MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
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
  if ((swap !== null && swap >= 75) || (used !== null && used >= 95)) return 'critical';
  if ((swap !== null && swap >= 40) || (used !== null && used >= 80)) return 'elevated';
  return 'normal';
}

function expectedPolicyFor(pressure) {
  if (pressure === 'critical' || pressure === 'unknown') return 'hold-current';
  if (pressure === 'elevated') return 'background-low';
  return 'balanced';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('Memory-policy swap-policy-alignment snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Memory-policy swap-policy-alignment requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.memory)) {
    throw new TypeError('Memory-policy swap-policy-alignment snapshot requires a memory section');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const used = percentOf(source.memory.usedPercent);
  const swap = percentOf(source.memory.swapUsedPercent);
  const observedPolicy = policyOf(source.memory.currentPolicy);
  const pressure = pressureFor(used.value, swap.value);
  const expectedPolicy = expectedPolicyFor(pressure);
  const invalid = used.invalid || swap.invalid
    || (source.memory.currentPolicy !== undefined && observedPolicy === null);
  const swapObserved = swap.value !== null;
  const policyObserved = observedPolicy !== null;
  const mismatch = policyObserved && pressure !== 'unknown' && observedPolicy !== expectedPolicy;
  const criticalMismatch = mismatch && pressure === 'critical';
  return Object.freeze({
    pressure,
    observedPolicy,
    expectedPolicy,
    swapObserved,
    policyObserved,
    mismatch,
    criticalMismatch,
    invalid
  });
}

function requireTrigger(trigger) {
  if (!MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported memory-policy swap-policy-alignment trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Memory-policy swap-policy-alignment windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Memory-policy swap-policy-alignment minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Memory-policy swap-policy-alignment ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => item.swapObserved && !item.invalid);
}

function stateFor(sampleCount, minimumSamples, swapObservedCount, policyObservedCount,
  invalidCount, mismatchCount, criticalMismatchCount, gapThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-swap-evidence';
  if (swapObservedCount === 0) return 'no-observation';
  if (swapObservedCount < minimumSamples) return 'swap-observation-required';
  if (policyObservedCount === 0) return 'policy-observation-required';
  if (criticalMismatchCount >= gapThreshold) return 'critical-swap-policy-gap';
  if (mismatchCount >= gapThreshold) return 'swap-policy-gap';
  return 'aligned-swap-policy';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-swap-policy-samples']);
  if (state === 'invalid-swap-evidence') return Object.freeze(['review-swap-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-swap-observation']);
  if (state === 'swap-observation-required') return Object.freeze(['collect-complete-swap-window']);
  if (state === 'policy-observation-required') return Object.freeze(['request-memory-policy-observation']);
  if (state === 'critical-swap-policy-gap') {
    return Object.freeze(['hold-current-under-critical-swap', 'review-policy-consent']);
  }
  if (state === 'swap-policy-gap') return Object.freeze(['review-swap-aware-memory-policy']);
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
    throw new TypeError('Memory-policy swap-policy-alignment clock must return a number');
  }
  return timestamp;
}

export function runMemoryPolicySwapPolicyAlignmentTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  gapThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('Memory-policy swap-policy-alignment samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredGap = requireCount('gapThreshold', gapThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const swapObservedCount = usable.length;
  const policyObservedCount = evidence.filter((item) => item.policyObserved && !item.invalid).length;
  const mismatchCount = evidence.filter((item) => item.mismatch && !item.invalid).length;
  const criticalMismatchCount = evidence.filter((item) => item.criticalMismatch && !item.invalid).length;
  const state = stateFor(selected.length, requiredSamples, swapObservedCount,
    policyObservedCount, invalidCount, mismatchCount, criticalMismatchCount, requiredGap);
  return Object.freeze({
    protocolVersion: 1,
    turbo: MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_TURBO_ID,
    turboVersion: MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount,
    invalidCount,
    swapObservedCount,
    policyObservedCount,
    mismatchCount,
    criticalMismatchCount,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
