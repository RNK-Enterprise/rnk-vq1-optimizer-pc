/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Memory-pressure headroom-volatility turbo. It measures bounded headroom
 * dispersion without reclaiming memory, touching files, or opening transport.
 */

export const MEMORY_PRESSURE_HEADROOM_VOLATILITY_TURBO_ID = 'memory-pressure.headroom-volatility';
export const MEMORY_PRESSURE_HEADROOM_VOLATILITY_TURBO_VERSION = 1;
export const MEMORY_PRESSURE_HEADROOM_VOLATILITY_TRIGGERS = Object.freeze([
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

function bytesOf(value) {
  if (!Number.isFinite(value)) return Object.freeze({ value: null, invalid: false });
  return Object.freeze({ value: Math.max(0, value), invalid: value < 0 });
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('Memory-pressure headroom-volatility snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Memory-pressure headroom-volatility requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.memory)) {
    throw new TypeError('Memory-pressure headroom-volatility snapshot requires a memory section');
  }
  return snapshot;
}

function evidenceOf(snapshot, lowHeadroomThreshold, lowAvailableRatioThreshold) {
  const memory = requireSnapshot(snapshot).memory;
  const used = percentOf(memory.usedPercent);
  const available = bytesOf(memory.availableBytes);
  const total = bytesOf(memory.totalBytes);
  const invalid = used.invalid || available.invalid || total.invalid
    || (available.value !== null && total.value !== null && available.value > total.value);
  const headroom = used.value === null ? null : 100 - used.value;
  const availableRatio = available.value === null || total.value === null || total.value === 0
    ? null : Math.min(100, (available.value / total.value) * 100);
  const lowMargin = (headroom !== null && headroom <= lowHeadroomThreshold)
    || (availableRatio !== null && availableRatio <= lowAvailableRatioThreshold);
  return Object.freeze({
    headroom,
    availableRatio,
    availableBytes: available.value,
    totalBytes: total.value,
    invalid,
    lowMargin
  });
}

function requireTrigger(trigger) {
  if (!MEMORY_PRESSURE_HEADROOM_VOLATILITY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported memory-pressure headroom-volatility trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Memory-pressure headroom-volatility windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Memory-pressure headroom-volatility minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requirePercent(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`Memory-pressure headroom-volatility ${name} must be between 0 and 100`);
  }
  return value;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Memory-pressure headroom-volatility ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => item.headroom !== null && !item.invalid);
}

function stats(evidence) {
  const values = observed(evidence).map((item) => item.headroom);
  if (values.length === 0) return {
    mean: null, minimum: null, maximum: null, range: 0, standardDeviation: 0, slope: null
  };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const usable = observed(evidence);
  const slope = usable.length < 2
    ? null : (usable.at(-1).headroom - usable[0].headroom) / (usable.length - 1);
  return {
    mean,
    minimum,
    maximum,
    range: maximum - minimum,
    standardDeviation: Math.sqrt(variance),
    slope
  };
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  lowCount, standardDeviation, range, slope, lowCountThreshold,
  standardDeviationThreshold, rangeThreshold, shrinkThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-headroom-evidence';
  if (observedCount === 0) return 'no-observation';
  if (lowCount >= lowCountThreshold) return 'low-headroom';
  if (standardDeviation >= standardDeviationThreshold || range >= rangeThreshold) {
    return 'volatile-headroom';
  }
  if (slope !== null && slope <= -shrinkThreshold) return 'shrinking-headroom';
  return 'stable-headroom';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-headroom-samples']);
  if (state === 'invalid-headroom-evidence') return Object.freeze(['review-memory-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-memory-headroom-observation']);
  if (state === 'low-headroom') return Object.freeze(['protect-memory-headroom', 'hold-destructive-actions']);
  if (state === 'volatile-headroom') return Object.freeze(['observe-memory-headroom-stability']);
  if (state === 'shrinking-headroom') return Object.freeze(['observe-memory-headroom-decline']);
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
    throw new TypeError('Memory-pressure headroom-volatility clock must return a number');
  }
  return timestamp;
}

export function runMemoryPressureHeadroomVolatilityTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  lowHeadroomThreshold = 15,
  lowAvailableRatioThreshold = 10,
  standardDeviationThreshold = 10,
  rangeThreshold = 25,
  shrinkThreshold = 5,
  lowCountThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('Memory-pressure headroom-volatility samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredLowHeadroom = requirePercent('lowHeadroomThreshold', lowHeadroomThreshold);
  const requiredLowAvailable = requirePercent('lowAvailableRatioThreshold', lowAvailableRatioThreshold);
  const requiredDeviation = requirePercent('standardDeviationThreshold', standardDeviationThreshold);
  const requiredRange = requirePercent('rangeThreshold', rangeThreshold);
  const requiredShrink = requirePercent('shrinkThreshold', shrinkThreshold);
  const requiredLowCount = requireCount('lowCountThreshold', lowCountThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredLowHeadroom,
    requiredLowAvailable));
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const lowCount = evidence.filter((item) => item.lowMargin).length;
  const measurements = stats(evidence);
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    lowCount, measurements.standardDeviation, measurements.range, measurements.slope,
    requiredLowCount, requiredDeviation, requiredRange, requiredShrink);
  return Object.freeze({
    protocolVersion: 1,
    turbo: MEMORY_PRESSURE_HEADROOM_VOLATILITY_TURBO_ID,
    turboVersion: MEMORY_PRESSURE_HEADROOM_VOLATILITY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount,
    invalidCount,
    lowHeadroomThreshold: requiredLowHeadroom,
    lowAvailableRatioThreshold: requiredLowAvailable,
    standardDeviationThreshold: requiredDeviation,
    rangeThreshold: requiredRange,
    shrinkThreshold: requiredShrink,
    lowHeadroomCount: lowCount,
    meanHeadroom: measurements.mean === null ? null : Math.round(measurements.mean * 10000) / 10000,
    minimumHeadroom: measurements.minimum,
    maximumHeadroom: measurements.maximum,
    headroomRange: Math.round(measurements.range * 10000) / 10000,
    standardDeviation: Math.round(measurements.standardDeviation * 10000) / 10000,
    slope: measurements.slope === null ? null : Math.round(measurements.slope * 10000) / 10000,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
