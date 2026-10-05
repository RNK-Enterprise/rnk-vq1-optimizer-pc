/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-scheduler context-churn turbo. It detects bounded context-switch
 * volatility and reversals without changing scheduler policy or process state.
 */

export const CPU_SCHEDULER_CHURN_TURBO_ID = 'cpu-scheduler.context-churn';
export const CPU_SCHEDULER_CHURN_TURBO_VERSION = 1;
export const CPU_SCHEDULER_CHURN_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function switchRate(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(16, value / 100000);
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('CPU-scheduler context-churn snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-scheduler context-churn requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-scheduler context-churn snapshot requires a CPU section');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!CPU_SCHEDULER_CHURN_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-scheduler context-churn trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-scheduler context-churn windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-scheduler context-churn minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireRateThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 16) {
    throw new RangeError('CPU-scheduler context-churn rateThreshold must be between 0 and 16');
  }
  return threshold;
}

function requireVolatilityThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 16) {
    throw new RangeError('CPU-scheduler context-churn volatilityThreshold must be between 0 and 16');
  }
  return threshold;
}

function requireReversalThreshold(threshold) {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 64) {
    throw new RangeError('CPU-scheduler context-churn reversalThreshold must be an integer from 1 to 64');
  }
  return threshold;
}

function valuesFor(samples) {
  return samples.map((snapshot) => switchRate(requireSnapshot(snapshot).cpu.contextSwitchesPerSecond));
}

function observedValues(values) {
  return values.filter((value) => value !== null);
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maximum(values) {
  return values.length === 0 ? null : Math.max(...values);
}

function highCount(values, threshold) {
  return values.filter((value) => value !== null && value >= threshold).length;
}

function deltas(values) {
  const changes = [];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] !== null && values[index - 1] !== null) {
      changes.push(values[index] - values[index - 1]);
    }
  }
  return changes;
}

function maximumDelta(changes) {
  return changes.length === 0 ? 0 : Math.max(...changes.map((change) => Math.abs(change)));
}

function reversalCount(changes) {
  let reversals = 0;
  for (let index = 1; index < changes.length; index += 1) {
    if (changes[index] !== 0 && changes[index - 1] !== 0
      && Math.sign(changes[index]) !== Math.sign(changes[index - 1])) {
      reversals += 1;
    }
  }
  return reversals;
}

function stateFor(sampleCount, minimumSamples, observedCount, highRate, highRateThreshold,
  maximumDeltaValue, volatilityThreshold, reversals, reversalThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (maximumDeltaValue >= volatilityThreshold) return 'volatile-churn';
  if (highRate >= highRateThreshold) return 'high-churn';
  if (reversals >= reversalThreshold) return 'reversal-watch';
  return 'stable-churn';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-context-switch-samples']);
  if (state === 'no-observation') return Object.freeze(['request-context-switch-observation']);
  if (state === 'volatile-churn') return Object.freeze(['observe-context-switch-volatility']);
  if (state === 'high-churn') return Object.freeze(['observe-scheduler-churn-duration']);
  if (state === 'reversal-watch') return Object.freeze(['observe-next-churn-sample']);
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
    throw new TypeError('CPU-scheduler context-churn clock must return a number');
  }
  return timestamp;
}

export function runCpuSchedulerContextChurnTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  rateThreshold = 1,
  volatilityThreshold = 0.75,
  reversalThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-scheduler context-churn samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const highRateThreshold = requireRateThreshold(rateThreshold);
  const requiredVolatility = requireVolatilityThreshold(volatilityThreshold);
  const requiredReversals = requireReversalThreshold(reversalThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const values = valuesFor(selected);
  const observed = observedValues(values);
  const changes = deltas(values);
  const highRate = highCount(values, highRateThreshold);
  const effectiveRate = selected.length === 0 ? 0 : highRate / selected.length;
  const maximumDeltaValue = maximumDelta(changes);
  const reversals = reversalCount(changes);
  const state = stateFor(selected.length, requiredSamples, observed.length, effectiveRate,
    0.5, maximumDeltaValue, requiredVolatility, reversals, requiredReversals);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_SCHEDULER_CHURN_TURBO_ID,
    turboVersion: CPU_SCHEDULER_CHURN_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    rateThreshold: highRateThreshold,
    volatilityThreshold: requiredVolatility,
    reversalThreshold: requiredReversals,
    observedCount: observed.length,
    highRateCount: highRate,
    highRateFraction: Math.round(effectiveRate * 10000) / 10000,
    peakSwitchRate: maximum(observed) === null ? null : Math.round(maximum(observed) * 10000) / 10000,
    meanSwitchRate: mean(observed) === null ? null : Math.round(mean(observed) * 10000) / 10000,
    maximumDelta: Math.round(maximumDeltaValue * 10000) / 10000,
    reversalCount: reversals,
    state,
    confidence: confidence(selected.length, observed.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
