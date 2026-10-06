/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Swap accounting-consistency turbo. It compares capacity accounting with
 * reported utilization without creating swap, changing swappiness, or opening
 * transport.
 */

export const SWAP_ACCOUNTING_CONSISTENCY_TURBO_ID = 'swap.accounting-consistency';
export const SWAP_ACCOUNTING_CONSISTENCY_TURBO_VERSION = 1;
export const SWAP_ACCOUNTING_CONSISTENCY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  if (!Number.isFinite(value)) return Object.freeze({ value: null, invalid: false });
  return Object.freeze({ value: Math.max(0, value), invalid: value < 0 });
}

function percentOf(value) {
  if (!Number.isFinite(value)) return Object.freeze({ value: null, invalid: false });
  return Object.freeze({
    value: Math.min(100, Math.max(0, value)),
    invalid: value < 0 || value > 100
  });
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Swap accounting-consistency snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Swap accounting-consistency requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.memory)) {
    throw new TypeError('Swap accounting-consistency snapshot requires a memory section');
  }
  return snapshot;
}

function evidenceOf(snapshot, consistencyThreshold) {
  const source = requireSnapshot(snapshot);
  const total = nonNegative(source.memory.swapTotalBytes);
  const free = nonNegative(source.memory.swapFreeBytes);
  const used = percentOf(source.memory.swapUsedPercent);
  if (total.value === 0) {
    const invalid = total.invalid || free.invalid || used.invalid
      || free.value !== 0 || (used.value !== null && used.value !== 0);
    return Object.freeze({ state: 'no-swap', deltaPercent: null, invalid });
  }
  if (total.value === null || free.value === null || used.value === null) {
    return Object.freeze({ state: 'unknown', deltaPercent: null,
      invalid: total.invalid || free.invalid || used.invalid });
  }
  const invalid = total.invalid || free.invalid || used.invalid || free.value > total.value;
  if (invalid) return Object.freeze({ state: 'invalid', deltaPercent: null, invalid: true });
  const expectedUsed = ((total.value - free.value) / total.value) * 100;
  const deltaPercent = Math.abs(expectedUsed - used.value);
  return Object.freeze({
    state: deltaPercent <= consistencyThreshold ? 'consistent' : 'accounting-drift',
    deltaPercent,
    invalid: false
  });
}

function requireTrigger(trigger) {
  if (!SWAP_ACCOUNTING_CONSISTENCY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported swap accounting-consistency trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Swap accounting-consistency windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Swap accounting-consistency minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('Swap accounting-consistency consistencyThreshold must be between 0 and 100');
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => item.state === 'consistent' || item.state === 'accounting-drift');
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  noSwapCount, driftCount) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-accounting-evidence';
  if (observedCount === 0 && noSwapCount > 0) return 'no-swap';
  if (observedCount === 0) return 'no-observation';
  if (driftCount > 0) return 'accounting-drift';
  return 'accounting-consistent';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-swap-accounting-samples']);
  if (state === 'invalid-accounting-evidence') return Object.freeze(['review-swap-accounting-sensors']);
  if (state === 'no-observation') return Object.freeze(['request-swap-accounting-observation']);
  if (state === 'no-swap') return Object.freeze(['no-change', 'keep-no-swap-user-owned']);
  if (state === 'accounting-drift') return Object.freeze(['hold-swap-policy-automation', 'review-sensor-agreement']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Swap accounting-consistency clock must return a number');
  return timestamp;
}

export function runSwapAccountingConsistencyTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  consistencyThreshold = 10,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Swap accounting-consistency samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredThreshold = requireThreshold(consistencyThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredThreshold));
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const noSwapCount = evidence.filter((item) => item.state === 'no-swap' && !item.invalid).length;
  const driftCount = evidence.filter((item) => item.state === 'accounting-drift').length;
  const consistentCount = evidence.filter((item) => item.state === 'consistent').length;
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    noSwapCount, driftCount);
  return Object.freeze({
    protocolVersion: 1,
    turbo: SWAP_ACCOUNTING_CONSISTENCY_TURBO_ID,
    turboVersion: SWAP_ACCOUNTING_CONSISTENCY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount - noSwapCount,
    invalidCount,
    noSwapCount,
    consistentCount,
    driftCount,
    consistencyThreshold: requiredThreshold,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
