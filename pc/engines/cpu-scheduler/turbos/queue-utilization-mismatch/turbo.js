/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * CPU-scheduler queue-utilization-mismatch turbo. It compares normalized
 * queue pressure with utilization evidence without changing scheduler state.
 */

export const CPU_SCHEDULER_MISMATCH_TURBO_ID = 'cpu-scheduler.queue-utilization-mismatch';
export const CPU_SCHEDULER_MISMATCH_TURBO_VERSION = 1;
export const CPU_SCHEDULER_MISMATCH_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedUtilization(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value / 100));
}

function boundedQueue(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function queuePressure(queue, logicalCpus) {
  if (queue === null) return null;
  if (!Number.isInteger(logicalCpus) || logicalCpus < 1) return Math.min(4, queue / 8);
  return Math.min(4, queue / logicalCpus);
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('CPU-scheduler queue-utilization-mismatch snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-scheduler queue-utilization-mismatch requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-scheduler queue-utilization-mismatch snapshot requires a CPU section');
  }
  return snapshot;
}

function mismatchOf(snapshot) {
  const cpu = requireSnapshot(snapshot).cpu;
  const queue = queuePressure(boundedQueue(cpu.runQueueLength), cpu.logicalCpus);
  const utilization = boundedUtilization(cpu.utilizationPercent);
  if (queue === null || utilization === null) return null;
  return Math.abs((queue / 4) - utilization);
}

function patternOf(snapshot) {
  const cpu = requireSnapshot(snapshot).cpu;
  const queue = queuePressure(boundedQueue(cpu.runQueueLength), cpu.logicalCpus);
  const utilization = boundedUtilization(cpu.utilizationPercent);
  if (queue === null || utilization === null) return 'unknown';
  if (queue >= 1 && utilization <= 0.5) return 'queued-low-utilization';
  if (queue < 0.5 && utilization >= 0.8) return 'busy-low-queue';
  return 'aligned';
}

function requireTrigger(trigger) {
  if (!CPU_SCHEDULER_MISMATCH_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-scheduler queue-utilization-mismatch trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-scheduler queue-utilization-mismatch windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-scheduler queue-utilization-mismatch minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireRateThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('CPU-scheduler queue-utilization-mismatch mismatchRateThreshold must be between 0 and 1');
  }
  return threshold;
}

function requireRiseThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('CPU-scheduler queue-utilization-mismatch riseThreshold must be between 0 and 1');
  }
  return threshold;
}

function requirePatternCount(count) {
  if (!Number.isInteger(count) || count < 1 || count > 64) {
    throw new RangeError('CPU-scheduler queue-utilization-mismatch patternCount must be an integer from 1 to 64');
  }
  return count;
}

function valuesFor(samples) {
  return samples.map(mismatchOf);
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

function countPattern(samples, pattern) {
  return samples.filter((sample) => patternOf(sample) === pattern).length;
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

function stateFor(sampleCount, minimumSamples, observedCount, lowUtilizationCount,
  busyLowQueueCount, mismatchRate, mismatchRateThreshold, maximumRiseValue, riseThreshold,
  patternCount) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (lowUtilizationCount >= patternCount) return 'queued-low-utilization';
  if (busyLowQueueCount >= patternCount) return 'busy-low-queue';
  if (mismatchRate >= mismatchRateThreshold) return 'mismatch-burst';
  if (maximumRiseValue >= riseThreshold) return 'rising-mismatch';
  return 'aligned-window';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-scheduler-samples']);
  if (state === 'no-observation') return Object.freeze(['request-queue-utilization-observation']);
  if (state === 'queued-low-utilization') return Object.freeze(['review-queue-or-idle-accounting']);
  if (state === 'busy-low-queue') return Object.freeze(['review-utilization-or-queue-accounting']);
  if (state === 'mismatch-burst') return Object.freeze(['observe-queue-utilization-alignment']);
  if (state === 'rising-mismatch') return Object.freeze(['observe-next-queue-utilization-sample']);
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
    throw new TypeError('CPU-scheduler queue-utilization-mismatch clock must return a number');
  }
  return timestamp;
}

export function runCpuSchedulerQueueUtilizationMismatchTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  mismatchRateThreshold = 0.5,
  riseThreshold = 0.25,
  patternCount = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-scheduler queue-utilization-mismatch samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const rateThreshold = requireRateThreshold(mismatchRateThreshold);
  const requiredRise = requireRiseThreshold(riseThreshold);
  const requiredPatterns = requirePatternCount(patternCount);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const values = valuesFor(selected);
  const observed = observedValues(values);
  const lowUtilizationCount = countPattern(selected, 'queued-low-utilization');
  const busyLowQueueCount = countPattern(selected, 'busy-low-queue');
  const mismatchRate = selected.length === 0 ? 0 : (mean(observed) || 0);
  const maximumRiseValue = maximumRise(values);
  const state = stateFor(selected.length, requiredSamples, observed.length, lowUtilizationCount,
    busyLowQueueCount, mismatchRate, rateThreshold, maximumRiseValue, requiredRise,
    requiredPatterns);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_SCHEDULER_MISMATCH_TURBO_ID,
    turboVersion: CPU_SCHEDULER_MISMATCH_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    mismatchRateThreshold: rateThreshold,
    riseThreshold: requiredRise,
    patternCount: requiredPatterns,
    observedCount: observed.length,
    mismatchRate: Math.round(mismatchRate * 10000) / 10000,
    queuedLowUtilizationCount: lowUtilizationCount,
    busyLowQueueCount,
    peakMismatch: maximum(observed) === null ? null : Math.round(maximum(observed) * 10000) / 10000,
    meanMismatch: mean(observed) === null ? null : Math.round(mean(observed) * 10000) / 10000,
    maximumRise: Math.round(maximumRiseValue * 10000) / 10000,
    state,
    confidence: confidence(selected.length, observed.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
