/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-utilization burst-window turbo. It detects bounded short CPU bursts
 * from normalized snapshots. It never changes CPU policy or emits actions.
 */

export const CPU_UTILIZATION_BURST_TURBO_ID = 'cpu-utilization.burst-window';
export const CPU_UTILIZATION_BURST_TURBO_VERSION = 1;
export const CPU_UTILIZATION_BURST_TRIGGERS = Object.freeze([
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
  if (!CPU_UTILIZATION_BURST_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-utilization burst-window trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-utilization burst-window windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-utilization burst-window minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requirePercentThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError('CPU-utilization burst-window burstThreshold must be between 0 and 100');
  }
  return threshold;
}

function requireRateThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('CPU-utilization burst-window burstRateThreshold must be between 0 and 1');
  }
  return threshold;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('CPU-utilization burst-window snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-utilization burst-window requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-utilization burst-window snapshot requires a CPU section');
  }
  return snapshot;
}

function valuesFor(samples) {
  return samples.map((snapshot) => utilizationOf(requireSnapshot(snapshot).cpu.utilizationPercent));
}

function observedValues(values) {
  return values.filter((value) => value !== null);
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function peak(values) {
  return values.length === 0 ? null : Math.max(...values);
}

function burstCount(values, threshold) {
  return values.filter((value) => value !== null && value >= threshold).length;
}

function maximumRise(values) {
  if (values.length < 2) return 0;
  let maximum = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] !== null && values[index - 1] !== null) {
      maximum = Math.max(maximum, values[index] - values[index - 1]);
    }
  }
  return maximum;
}

function stateFor(sampleCount, minimumSamples, observedCount, burstRate, burstRateThreshold, maximumRisePercent) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (burstRate >= burstRateThreshold) return 'burst-detected';
  if (maximumRisePercent >= 20) return 'rising-burst';
  return 'stable-window';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cpu-samples']);
  if (state === 'no-observation') return Object.freeze(['request-cpu-utilization-observation']);
  if (state === 'burst-detected') return Object.freeze(['observe-burst-duration', 'hold-unapproved-policy-change']);
  if (state === 'rising-burst') return Object.freeze(['observe-next-cpu-sample']);
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
    throw new TypeError('CPU-utilization burst-window clock must return a number');
  }
  return timestamp;
}

export function runCpuUtilizationBurstWindowTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  burstThreshold = 75,
  burstRateThreshold = 0.5,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-utilization burst-window samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const threshold = requirePercentThreshold(burstThreshold);
  const rateThreshold = requireRateThreshold(burstRateThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const values = valuesFor(selected);
  const observed = observedValues(values);
  const count = burstCount(values, threshold);
  const effectiveRate = selected.length === 0 ? 0 : count / selected.length;
  const maximumRisePercent = maximumRise(values);
  const state = stateFor(
    selected.length,
    requiredSamples,
    observed.length,
    effectiveRate,
    rateThreshold,
    maximumRisePercent
  );
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_UTILIZATION_BURST_TURBO_ID,
    turboVersion: CPU_UTILIZATION_BURST_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    burstThreshold: threshold,
    burstRateThreshold: rateThreshold,
    observedCount: observed.length,
    burstCount: count,
    burstRate: Math.round(effectiveRate * 10000) / 10000,
    peakUtilizationPercent: peak(observed),
    meanUtilizationPercent: mean(observed) === null ? null : Math.round(mean(observed) * 100) / 100,
    maximumRisePercent: Math.round(maximumRisePercent * 100) / 100,
    state,
    confidence: confidence(selected.length, observed.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
