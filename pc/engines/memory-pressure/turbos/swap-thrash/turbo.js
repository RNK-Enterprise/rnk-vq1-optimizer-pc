/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Memory-pressure swap-thrash turbo. It classifies bounded swap activity and
 * oscillation without reclaiming memory, changing swap policy, or opening transport.
 */

export const MEMORY_PRESSURE_SWAP_THRASH_TURBO_ID = 'memory-pressure.swap-thrash';
export const MEMORY_PRESSURE_SWAP_THRASH_TURBO_VERSION = 1;
export const MEMORY_PRESSURE_SWAP_THRASH_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

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

function rateOf(value) {
  if (!Number.isFinite(value)) return Object.freeze({ value: null, invalid: false });
  return Object.freeze({ value: Math.max(0, value), invalid: value < 0 });
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('Memory-pressure swap-thrash snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Memory-pressure swap-thrash requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.memory)) {
    throw new TypeError('Memory-pressure swap-thrash snapshot requires a memory section');
  }
  return snapshot;
}

function evidenceOf(snapshot, swapUseThreshold, activityThreshold, memoryPressureThreshold) {
  const memory = requireSnapshot(snapshot).memory;
  const swap = percentOf(memory.swapUsedPercent);
  const used = percentOf(memory.usedPercent);
  const incoming = rateOf(memory.swapInRate);
  const outgoing = rateOf(memory.swapOutRate);
  const activity = incoming.value === null || outgoing.value === null
    ? null : incoming.value + outgoing.value;
  const invalid = swap.invalid || used.invalid || incoming.invalid || outgoing.invalid;
  const active = swap.value !== null && activity !== null && used.value !== null
    && swap.value >= swapUseThreshold && activity >= activityThreshold
    && used.value >= memoryPressureThreshold;
  const reclaimChurn = activity !== null && activity >= activityThreshold && !active;
  return Object.freeze({
    swapUsedPercent: swap.value,
    usedPercent: used.value,
    incomingRate: incoming.value,
    outgoingRate: outgoing.value,
    activity,
    invalid,
    active,
    reclaimChurn
  });
}

function requireTrigger(trigger) {
  if (!MEMORY_PRESSURE_SWAP_THRASH_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported memory-pressure swap-thrash trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Memory-pressure swap-thrash windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Memory-pressure swap-thrash minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requirePercent(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`Memory-pressure swap-thrash ${name} must be between 0 and 100`);
  }
  return value;
}

function requireRateThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1000000000) {
    throw new RangeError('Memory-pressure swap-thrash activityThreshold must be between 0 and 1000000000');
  }
  return value;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Memory-pressure swap-thrash ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => item.swapUsedPercent !== null
    && item.activity !== null && !item.invalid);
}

function movement(evidence, growthThreshold) {
  let growthCount = 0;
  let reversalCount = 0;
  let comparisons = 0;
  let absoluteTotal = 0;
  let previousDirection = 0;
  for (let index = 1; index < evidence.length; index += 1) {
    const previous = evidence[index - 1].swapUsedPercent;
    const current = evidence[index].swapUsedPercent;
    if (previous === null || current === null) continue;
    const delta = current - previous;
    comparisons += 1;
    absoluteTotal += Math.abs(delta);
    const direction = delta === 0 ? 0 : delta > 0 ? 1 : -1;
    if (delta >= growthThreshold) growthCount += 1;
    if (direction !== 0 && previousDirection !== 0 && direction !== previousDirection) {
      reversalCount += 1;
    }
    if (direction !== 0) previousDirection = direction;
  }
  return {
    growthCount,
    reversalCount,
    comparisons,
    averageAbsoluteDelta: comparisons === 0 ? 0 : absoluteTotal / comparisons
  };
}

function slopeOf(evidence) {
  const usable = observed(evidence);
  if (usable.length < 2) return null;
  return (usable.at(-1).swapUsedPercent - usable[0].swapUsedPercent) / (usable.length - 1);
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  activeCount, reclaimCount, slope, averageAbsoluteDelta, reversalCount,
  growthThreshold, volatilityThreshold, reversalThreshold, activeCountThreshold,
  reclaimCountThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-swap-evidence';
  if (observedCount === 0) return 'no-observation';
  if (activeCount >= activeCountThreshold) return 'active-thrash';
  if (reclaimCount >= reclaimCountThreshold) return 'reclaim-churn';
  if (slope !== null && slope >= growthThreshold) return 'rising-swap';
  if (averageAbsoluteDelta >= volatilityThreshold || reversalCount >= reversalThreshold) {
    return 'volatile-swap';
  }
  return 'stable-swap';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-swap-samples']);
  if (state === 'invalid-swap-evidence') return Object.freeze(['review-swap-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-swap-activity-observation']);
  if (state === 'active-thrash') return Object.freeze(['review-memory-pressure-before-swap-control']);
  if (state === 'reclaim-churn') return Object.freeze(['observe-reclaim-activity']);
  if (state === 'rising-swap') return Object.freeze(['observe-swap-growth']);
  if (state === 'volatile-swap') return Object.freeze(['observe-swap-stability']);
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
    throw new TypeError('Memory-pressure swap-thrash clock must return a number');
  }
  return timestamp;
}

export function runMemoryPressureSwapThrashTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  swapUseThreshold = 50,
  activityThreshold = 10,
  memoryPressureThreshold = 75,
  growthThreshold = 10,
  volatilityThreshold = 15,
  reversalThreshold = 2,
  activeCountThreshold = 2,
  reclaimCountThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('Memory-pressure swap-thrash samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredSwapUse = requirePercent('swapUseThreshold', swapUseThreshold);
  const requiredActivity = requireRateThreshold(activityThreshold);
  const requiredMemoryPressure = requirePercent('memoryPressureThreshold', memoryPressureThreshold);
  const requiredGrowth = requirePercent('growthThreshold', growthThreshold);
  const requiredVolatility = requirePercent('volatilityThreshold', volatilityThreshold);
  const requiredReversals = requireCount('reversalThreshold', reversalThreshold);
  const requiredActiveCount = requireCount('activeCountThreshold', activeCountThreshold);
  const requiredReclaimCount = requireCount('reclaimCountThreshold', reclaimCountThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredSwapUse,
    requiredActivity, requiredMemoryPressure));
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const activeCount = evidence.filter((item) => item.active).length;
  const reclaimCount = evidence.filter((item) => item.reclaimChurn).length;
  const trend = movement(evidence, requiredGrowth);
  const slope = slopeOf(evidence);
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    activeCount, reclaimCount, slope, trend.averageAbsoluteDelta, trend.reversalCount,
    requiredGrowth, requiredVolatility, requiredReversals, requiredActiveCount,
    requiredReclaimCount);
  return Object.freeze({
    protocolVersion: 1,
    turbo: MEMORY_PRESSURE_SWAP_THRASH_TURBO_ID,
    turboVersion: MEMORY_PRESSURE_SWAP_THRASH_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount,
    invalidCount,
    swapUseThreshold: requiredSwapUse,
    activityThreshold: requiredActivity,
    memoryPressureThreshold: requiredMemoryPressure,
    activeCount,
    reclaimCount,
    growthCount: trend.growthCount,
    comparisonCount: trend.comparisons,
    reversalCount: trend.reversalCount,
    averageAbsoluteDelta: Math.round(trend.averageAbsoluteDelta * 10000) / 10000,
    slope: slope === null ? null : Math.round(slope * 10000) / 10000,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
