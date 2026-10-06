/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Swap availability-drift turbo. It observes bounded capacity changes without
 * creating swap, changing swappiness, or opening transport.
 */

export const SWAP_AVAILABILITY_DRIFT_TURBO_ID = 'swap.availability-drift';
export const SWAP_AVAILABILITY_DRIFT_TURBO_VERSION = 1;
export const SWAP_AVAILABILITY_DRIFT_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function capacityOf(value) {
  if (!Number.isFinite(value)) return Object.freeze({ value: null, invalid: false });
  return Object.freeze({ value: Math.max(0, value), invalid: value < 0 });
}

function availabilityFor(totalBytes) {
  if (totalBytes === null) return 'unknown';
  if (totalBytes === 0) return 'none';
  return 'available';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Swap availability-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Swap availability-drift requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.memory)) {
    throw new TypeError('Swap availability-drift snapshot requires a memory section');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const total = capacityOf(source.memory.swapTotalBytes);
  return Object.freeze({
    totalBytes: total.value,
    availability: availabilityFor(total.value),
    invalid: total.invalid
  });
}

function requireTrigger(trigger) {
  if (!SWAP_AVAILABILITY_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported swap availability-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Swap availability-drift windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Swap availability-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1e15) {
    throw new RangeError('Swap availability-drift changeThresholdBytes must be between 0 and 1e15');
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => item.availability === 'available' && !item.invalid);
}

function movement(evidence, changeThresholdBytes) {
  let increaseCount = 0;
  let decreaseCount = 0;
  let availabilityChanges = 0;
  let comparisonCount = 0;
  let previous = null;
  for (const current of evidence) {
    if (current.availability === 'unknown' || current.invalid) {
      previous = null;
      continue;
    }
    if (previous !== null) {
      comparisonCount += 1;
      if (current.availability !== previous.availability) availabilityChanges += 1;
      if (current.totalBytes - previous.totalBytes >= changeThresholdBytes) increaseCount += 1;
      if (previous.totalBytes - current.totalBytes >= changeThresholdBytes) decreaseCount += 1;
    }
    previous = current;
  }
  return { increaseCount, decreaseCount, availabilityChanges, comparisonCount };
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  noneCount, availabilityChanges, increaseCount, decreaseCount) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-availability-evidence';
  if (observedCount === 0 && noneCount > 0) return 'no-swap';
  if (observedCount === 0) return 'no-observation';
  if (availabilityChanges > 0) return 'availability-drift';
  if (decreaseCount > 0) return 'capacity-loss';
  if (increaseCount > 0) return 'capacity-gain';
  return 'stable-availability';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-swap-availability-samples']);
  if (state === 'invalid-availability-evidence') return Object.freeze(['review-swap-capacity-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-swap-availability-observation']);
  if (state === 'no-swap') return Object.freeze(['no-change', 'keep-no-swap-user-owned']);
  if (state === 'availability-drift') return Object.freeze(['review-swap-availability-change', 'hold-automatic-creation']);
  if (state === 'capacity-loss') return Object.freeze(['review-swap-capacity-loss']);
  if (state === 'capacity-gain') return Object.freeze(['observe-new-swap-capacity']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Swap availability-drift clock must return a number');
  return timestamp;
}

export function runSwapAvailabilityDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  changeThresholdBytes = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Swap availability-drift samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredThreshold = requireThreshold(changeThresholdBytes);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const noneCount = evidence.filter((item) => item.availability === 'none' && !item.invalid).length;
  const trend = movement(evidence, requiredThreshold);
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    noneCount, trend.availabilityChanges, trend.increaseCount, trend.decreaseCount);
  return Object.freeze({
    protocolVersion: 1,
    turbo: SWAP_AVAILABILITY_DRIFT_TURBO_ID,
    turboVersion: SWAP_AVAILABILITY_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount - noneCount,
    invalidCount,
    noneCount,
    increaseCount: trend.increaseCount,
    decreaseCount: trend.decreaseCount,
    availabilityChanges: trend.availabilityChanges,
    comparisonCount: trend.comparisonCount,
    changeThresholdBytes: requiredThreshold,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
