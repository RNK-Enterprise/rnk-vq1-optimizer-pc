/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-utilization trend-slope turbo. It measures bounded least-squares trend
 * and range volatility without changing frequency, scheduling, or affinity.
 */

export const CPU_UTILIZATION_TREND_TURBO_ID = 'cpu-utilization.trend-slope';
export const CPU_UTILIZATION_TREND_TURBO_VERSION = 1;
export const CPU_UTILIZATION_TREND_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function utilizationOf(value) {
  if (!Number.isFinite(value)) return null;
  return clamp(value, 0, 100);
}

function requireTrigger(trigger) {
  if (!CPU_UTILIZATION_TREND_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-utilization trend-slope trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-utilization trend-slope windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-utilization trend-slope minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(threshold, label) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError(`CPU-utilization trend-slope ${label} must be between 0 and 100`);
  }
  return threshold;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('CPU-utilization trend-slope snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-utilization trend-slope requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-utilization trend-slope snapshot requires a CPU section');
  }
  return snapshot;
}

function valuesFor(samples) {
  return samples.map((snapshot) => utilizationOf(requireSnapshot(snapshot).cpu.utilizationPercent));
}

function observed(values) {
  return values.map((value, index) => ({ value, index })).filter((item) => item.value !== null);
}

function mean(items) {
  return items.length === 0 ? null : items.reduce((sum, item) => sum + item.value, 0) / items.length;
}

function slope(items) {
  if (items.length < 2) return null;
  const xMean = items.reduce((sum, item) => sum + item.index, 0) / items.length;
  const yMean = mean(items);
  const numerator = items.reduce((sum, item) => sum + ((item.index - xMean) * (item.value - yMean)), 0);
  const denominator = items.reduce((sum, item) => sum + ((item.index - xMean) ** 2), 0);
  return numerator / denominator;
}

function range(items) {
  if (items.length === 0) return null;
  const values = items.map((item) => item.value);
  return Math.max(...values) - Math.min(...values);
}

function stateFor(sampleCount, minimumSamples, observedCount, slopeValue, rangeValue, slopeThreshold, volatilityThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (slopeValue !== null && slopeValue >= slopeThreshold) return 'rising-trend';
  if (slopeValue !== null && slopeValue <= -slopeThreshold) return 'falling-trend';
  if (rangeValue !== null && rangeValue >= volatilityThreshold) return 'volatile-window';
  return 'flat-window';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cpu-samples']);
  if (state === 'no-observation') return Object.freeze(['request-cpu-utilization-observation']);
  if (state === 'rising-trend') return Object.freeze(['observe-rising-cpu-demand']);
  if (state === 'falling-trend') return Object.freeze(['observe-falling-cpu-demand']);
  if (state === 'volatile-window') return Object.freeze(['observe-volatility-before-policy-review']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('CPU-utilization trend-slope clock must return a number');
  return timestamp;
}

export function runCpuUtilizationTrendSlopeTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  slopeThreshold = 5,
  volatilityThreshold = 30,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('CPU-utilization trend-slope samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const slopeLimit = requireThreshold(slopeThreshold, 'slopeThreshold');
  const volatilityLimit = requireThreshold(volatilityThreshold, 'volatilityThreshold');
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const values = valuesFor(selected);
  const items = observed(values);
  const slopeValue = slope(items);
  const rangeValue = range(items);
  const state = stateFor(selected.length, requiredSamples, items.length, slopeValue, rangeValue,
    slopeLimit, volatilityLimit);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_UTILIZATION_TREND_TURBO_ID,
    turboVersion: CPU_UTILIZATION_TREND_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    slopeThreshold: slopeLimit,
    volatilityThreshold: volatilityLimit,
    observedCount: items.length,
    meanUtilizationPercent: mean(items) === null ? null : Math.round(mean(items) * 100) / 100,
    slopePercentPerSample: slopeValue === null ? null : Math.round(slopeValue * 100) / 100,
    rangePercent: rangeValue === null ? null : Math.round(rangeValue * 100) / 100,
    state,
    confidence: confidence(selected.length, items.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
