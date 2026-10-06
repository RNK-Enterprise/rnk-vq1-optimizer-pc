/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Memory-policy consent-boundary turbo. It evaluates explicit consent and
 * destructive-action boundaries without approving or applying policy changes.
 */

export const MEMORY_POLICY_CONSENT_BOUNDARY_TURBO_ID = 'memory-policy.consent-boundary';
export const MEMORY_POLICY_CONSENT_BOUNDARY_TURBO_VERSION = 1;
export const MEMORY_POLICY_CONSENT_BOUNDARY_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const POLICIES = Object.freeze(['balanced', 'background-low', 'hold-current']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function booleanOf(value) {
  return typeof value === 'boolean' ? value : null;
}

function policyOf(value) {
  return POLICIES.includes(value) ? value : null;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('Memory-policy consent-boundary snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Memory-policy consent-boundary requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.memory)) {
    throw new TypeError('Memory-policy consent-boundary snapshot requires a memory section');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const currentPolicy = policyOf(source.memory.currentPolicy);
  const requestedPolicy = policyOf(source.memory.requestedPolicy);
  const consentGranted = booleanOf(source.memory.consentGranted);
  const destructiveActionRequested = booleanOf(source.memory.destructiveActionRequested);
  const invalid = (source.memory.currentPolicy !== undefined && currentPolicy === null)
    || (source.memory.requestedPolicy !== undefined && requestedPolicy === null)
    || (source.memory.consentGranted !== undefined && consentGranted === null)
    || (source.memory.destructiveActionRequested !== undefined && destructiveActionRequested === null);
  const hasRequest = requestedPolicy !== null;
  const policyChange = hasRequest && currentPolicy !== null && requestedPolicy !== currentPolicy;
  const consentRequired = policyChange;
  const consentGap = consentRequired && consentGranted !== true;
  const destructiveBlocked = destructiveActionRequested === true && consentGranted !== true;
  return Object.freeze({
    currentPolicy,
    requestedPolicy,
    consentGranted,
    destructiveActionRequested,
    hasRequest,
    policyChange,
    consentRequired,
    consentGap,
    destructiveBlocked,
    invalid
  });
}

function requireTrigger(trigger) {
  if (!MEMORY_POLICY_CONSENT_BOUNDARY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported memory-policy consent-boundary trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Memory-policy consent-boundary windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Memory-policy consent-boundary minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Memory-policy consent-boundary ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => !item.invalid && item.currentPolicy !== null);
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  blockedCount, consentGapCount, requestCount, blockedThreshold, gapThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-consent-evidence';
  if (observedCount === 0) return 'no-observation';
  if (blockedCount >= blockedThreshold) return 'destructive-blocked';
  if (consentGapCount >= gapThreshold) return 'consent-required';
  if (requestCount === 0) return 'no-policy-request';
  return 'consent-aligned';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-consent-samples']);
  if (state === 'invalid-consent-evidence') return Object.freeze(['review-policy-consent-input']);
  if (state === 'no-observation') return Object.freeze(['request-policy-consent-observation']);
  if (state === 'destructive-blocked') return Object.freeze(['hold-destructive-actions', 'require-explicit-consent']);
  if (state === 'consent-required') return Object.freeze(['require-explicit-consent', 'hold-policy-automation']);
  if (state === 'no-policy-request') return Object.freeze(['no-policy-change-request']);
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
    throw new TypeError('Memory-policy consent-boundary clock must return a number');
  }
  return timestamp;
}

export function runMemoryPolicyConsentBoundaryTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  blockedThreshold = 1,
  gapThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('Memory-policy consent-boundary samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredBlocked = requireCount('blockedThreshold', blockedThreshold);
  const requiredGap = requireCount('gapThreshold', gapThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const blockedCount = evidence.filter((item) => item.destructiveBlocked).length;
  const consentGapCount = evidence.filter((item) => item.consentGap).length;
  const requestCount = evidence.filter((item) => item.hasRequest).length;
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    blockedCount, consentGapCount, requestCount, requiredBlocked, requiredGap);
  return Object.freeze({
    protocolVersion: 1,
    turbo: MEMORY_POLICY_CONSENT_BOUNDARY_TURBO_ID,
    turboVersion: MEMORY_POLICY_CONSENT_BOUNDARY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount,
    invalidCount,
    blockedCount,
    consentGapCount,
    requestCount,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
