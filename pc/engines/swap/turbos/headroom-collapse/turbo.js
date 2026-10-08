/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Swap headroom-collapse turbo. It measures bounded free-headroom movement
 * without creating swap, changing swappiness, or opening transport.
 */

export const SWAP_HEADROOM_COLLAPSE_TURBO_ID = 'swap.headroom-collapse';
export const SWAP_HEADROOM_COLLAPSE_TURBO_VERSION = 1;
export const SWAP_HEADROOM_COLLAPSE_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedNonNegative(value) {
  if (!Number.isFinite(value)) return Object.freeze({ value: null, invalid: false });
  return Object.freeze({ value: Math.max(0, value), invalid: value < 0 });
}

function headroomOf(total, free) {
  if (total === 0) return Object.freeze({ value: null, state: 'none', invalid: free !== 0 });
  if (total === null || free === null) return Object.freeze({ value: null, state: 'unknown', invalid: false });
  if (free > total) return Object.freeze({ value: null, state: 'invalid', invalid: true });
  return Object.freeze({ value: (free / total) * 100, state: 'observed', invalid: false });
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Swap headroom-collapse snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Swap headroom-collapse requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.memory)) {
    throw new TypeError('Swap headroom-collapse snapshot requires a memory section');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const total = boundedNonNegative(source.memory.swapTotalBytes);
  const free = boundedNonNegative(source.memory.swapFreeBytes);
  const headroom = headroomOf(total.value, free.value);
  return Object.freeze({
    headroomPercent: headroom.value,
    state: headroom.state,
    invalid: total.invalid || free.invalid || headroom.invalid
  });
}

function requireTrigger(trigger) {
  if (!SWAP_HEADROOM_COLLAPSE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported swap headroom-collapse trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Swap headroom-collapse windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Swap headroom-collapse minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new RangeError(`Swap headroom-collapse ${name} must be an integer from 1 to 100`);
  }
  return value;
}

function validObservations(evidence) {
  return evidence.filter((item) => item.state === 'observed' && item.headroomPercent !== null && !item.invalid);
}

function movement(evidence, collapseThreshold, recoveryThreshold) {
  let collapseCount = 0;
  let recoveryCount = 0;
  let comparisonCount = 0;
  let previous = null;
  for (const item of evidence) {
    if (item.state !== 'observed' || item.invalid || item.headroomPercent === null) continue;
    if (previous !== null) {
      const delta = item.headroomPercent - previous;
      comparisonCount += 1;
      if (delta <= -collapseThreshold) collapseCount += 1;
      if (delta >= recoveryThreshold) recoveryCount += 1;
    }
    previous = item.headroomPercent;
  }
  return { collapseCount, recoveryCount, comparisonCount };
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  noSwapCount, collapseCount, recoveryCount, collapseThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-headroom-evidence';
  if (observedCount === 0 && noSwapCount > 0) return 'no-swap';
  if (observedCount === 0) return 'no-observation';
  if (collapseCount >= collapseThreshold) return 'headroom-collapse';
  if (recoveryCount >= collapseThreshold) return 'headroom-recovery';
  return 'stable-headroom';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-swap-headroom-samples']);
  if (state === 'invalid-headroom-evidence') return Object.freeze(['review-swap-capacity-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-swap-headroom-observation']);
  if (state === 'no-swap') return Object.freeze(['no-change', 'keep-no-swap-user-owned']);
  if (state === 'headroom-collapse') return Object.freeze(['hold-destructive-actions', 'observe-swap-headroom']);
  if (state === 'headroom-recovery') return Object.freeze(['observe-swap-headroom-recovery']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Swap headroom-collapse clock must return a number');
  return timestamp;
}

export function runSwapHeadroomCollapseTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  collapseThreshold = 10,
  recoveryThreshold = 10,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Swap headroom-collapse samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredCollapse = requireCount('collapseThreshold', collapseThreshold);
  const requiredRecovery = requireCount('recoveryThreshold', recoveryThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usable = validObservations(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const noSwapCount = evidence.filter((item) => item.state === 'none' && !item.invalid).length;
  const trend = movement(evidence, requiredCollapse, requiredRecovery);
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    noSwapCount, trend.collapseCount, trend.recoveryCount, 1);
  return Object.freeze({
    protocolVersion: 1,
    turbo: SWAP_HEADROOM_COLLAPSE_TURBO_ID,
    turboVersion: SWAP_HEADROOM_COLLAPSE_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount - noSwapCount,
    invalidCount,
    noSwapCount,
    collapseCount: trend.collapseCount,
    recoveryCount: trend.recoveryCount,
    comparisonCount: trend.comparisonCount,
    collapseThreshold: requiredCollapse,
    recoveryThreshold: requiredRecovery,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
