/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-scheduler run-queue-burst turbo. It measures bounded queue and
 * context-switch pressure from normalized snapshots without changing policy.
 */

export const CPU_SCHEDULER_QUEUE_TURBO_ID = 'cpu-scheduler.run-queue-burst';
export const CPU_SCHEDULER_QUEUE_TURBO_VERSION = 1;
export const CPU_SCHEDULER_QUEUE_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function pressureFromQueue(queue, logicalCpus) {
  if (queue === null) return null;
  if (logicalCpus === null) return Math.min(16, queue / 8);
  return Math.min(16, queue / Math.max(1, logicalCpus));
}

function pressureFromSwitches(contextSwitches) {
  if (contextSwitches === null) return null;
  return Math.min(16, contextSwitches / 100000);
}

function pressureFromSnapshot(snapshot) {
  const cpu = requireSnapshot(snapshot).cpu;
  const queue = nonNegative(cpu.runQueueLength);
  const switches = nonNegative(cpu.contextSwitchesPerSecond);
  const logicalCpus = Number.isInteger(cpu.logicalCpus) && cpu.logicalCpus > 0
    ? cpu.logicalCpus
    : null;
  const queuePressure = pressureFromQueue(queue, logicalCpus);
  const switchPressure = pressureFromSwitches(switches);
  if (queuePressure === null) return switchPressure;
  if (switchPressure === null) return queuePressure;
  return Math.max(queuePressure, switchPressure);
}

function requireTrigger(trigger) {
  if (!CPU_SCHEDULER_QUEUE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-scheduler run-queue-burst trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-scheduler run-queue-burst windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-scheduler run-queue-burst minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requirePressureThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 16) {
    throw new RangeError('CPU-scheduler run-queue-burst pressureThreshold must be between 0 and 16');
  }
  return threshold;
}

function requireRateThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('CPU-scheduler run-queue-burst burstRateThreshold must be between 0 and 1');
  }
  return threshold;
}

function requireRunLength(runLength) {
  if (!Number.isInteger(runLength) || runLength < 2 || runLength > 64) {
    throw new RangeError('CPU-scheduler run-queue-burst sustainedRunLength must be an integer from 2 to 64');
  }
  return runLength;
}

function requireRiseThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 16) {
    throw new RangeError('CPU-scheduler run-queue-burst riseThreshold must be between 0 and 16');
  }
  return threshold;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('CPU-scheduler run-queue-burst snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-scheduler run-queue-burst requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-scheduler run-queue-burst snapshot requires a CPU section');
  }
  return snapshot;
}

function valuesFor(samples) {
  return samples.map(pressureFromSnapshot);
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

function burstCount(values, threshold) {
  return values.filter((value) => value !== null && value >= threshold).length;
}

function maximumRise(values) {
  if (values.length < 2) return 0;
  let maximumValue = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] !== null && values[index - 1] !== null) {
      maximumValue = Math.max(maximumValue, values[index] - values[index - 1]);
    }
  }
  return maximumValue;
}

function longestRun(values, threshold) {
  let current = 0;
  let longest = 0;
  for (const value of values) {
    if (value !== null && value >= threshold) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function stateFor(sampleCount, minimumSamples, observedCount, burstRate, burstRateThreshold,
  longestHighRun, sustainedRunLength, maximumRiseValue, riseThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (longestHighRun >= sustainedRunLength) return 'sustained-pressure';
  if (burstRate >= burstRateThreshold) return 'burst-detected';
  if (maximumRiseValue >= riseThreshold) return 'rising-pressure';
  return 'stable-window';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-scheduler-samples']);
  if (state === 'no-observation') return Object.freeze(['request-scheduler-observation']);
  if (state === 'sustained-pressure') return Object.freeze(['protect-scheduler-headroom']);
  if (state === 'burst-detected') return Object.freeze(['observe-run-queue-duration']);
  if (state === 'rising-pressure') return Object.freeze(['observe-next-scheduler-sample']);
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
    throw new TypeError('CPU-scheduler run-queue-burst clock must return a number');
  }
  return timestamp;
}

export function runCpuSchedulerRunQueueBurstTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  pressureThreshold = 1,
  burstRateThreshold = 0.5,
  sustainedRunLength = 3,
  riseThreshold = 0.5,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-scheduler run-queue-burst samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const threshold = requirePressureThreshold(pressureThreshold);
  const rateThreshold = requireRateThreshold(burstRateThreshold);
  const requiredRunLength = requireRunLength(sustainedRunLength);
  const requiredRise = requireRiseThreshold(riseThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const values = valuesFor(selected);
  const observed = observedValues(values);
  const count = burstCount(values, threshold);
  const effectiveRate = selected.length === 0 ? 0 : count / selected.length;
  const maximumRiseValue = maximumRise(values);
  const longestHighRun = longestRun(values, threshold);
  const state = stateFor(selected.length, requiredSamples, observed.length, effectiveRate,
    rateThreshold, longestHighRun, requiredRunLength, maximumRiseValue, requiredRise);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_SCHEDULER_QUEUE_TURBO_ID,
    turboVersion: CPU_SCHEDULER_QUEUE_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    pressureThreshold: threshold,
    burstRateThreshold: rateThreshold,
    sustainedRunLength: requiredRunLength,
    riseThreshold: requiredRise,
    observedCount: observed.length,
    burstCount: count,
    burstRate: Math.round(effectiveRate * 10000) / 10000,
    peakPressure: maximum(observed) === null ? null : Math.round(maximum(observed) * 10000) / 10000,
    meanPressure: mean(observed) === null ? null : Math.round(mean(observed) * 10000) / 10000,
    maximumRise: Math.round(maximumRiseValue * 10000) / 10000,
    longestHighRun,
    state,
    confidence: confidence(selected.length, observed.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
