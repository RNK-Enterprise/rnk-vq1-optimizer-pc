/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Memory-pressure OOM-margin turbo. It classifies bounded composite memory
 * margin without reclaiming memory, touching files, or opening transport.
 */

export const MEMORY_PRESSURE_OOM_MARGIN_TURBO_ID = 'memory-pressure.oom-margin';
export const MEMORY_PRESSURE_OOM_MARGIN_TURBO_VERSION = 1;
export const MEMORY_PRESSURE_OOM_MARGIN_TRIGGERS = Object.freeze([
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
    throw new TypeError('Memory-pressure oom-margin snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Memory-pressure oom-margin requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.memory)) {
    throw new TypeError('Memory-pressure oom-margin snapshot requires a memory section');
  }
  return snapshot;
}

function evidenceOf(snapshot, criticalMarginThreshold, narrowMarginThreshold) {
  const memory = requireSnapshot(snapshot).memory;
  const used = percentOf(memory.usedPercent);
  const available = bytesOf(memory.availableBytes);
  const total = bytesOf(memory.totalBytes);
  const invalid = used.invalid || available.invalid || total.invalid
    || (available.value !== null && total.value !== null && available.value > total.value);
  const headroom = used.value === null ? null : 100 - used.value;
  const availableRatio = available.value === null || total.value === null || total.value === 0
    ? null : Math.min(100, (available.value / total.value) * 100);
  const margin = headroom === null ? null
    : Math.min(headroom, availableRatio === null ? headroom : availableRatio);
  return Object.freeze({
    headroom,
    availableRatio,
    margin,
    invalid,
    critical: margin !== null && margin <= criticalMarginThreshold,
    narrow: margin !== null && margin <= narrowMarginThreshold
  });
}

function requireTrigger(trigger) {
  if (!MEMORY_PRESSURE_OOM_MARGIN_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported memory-pressure oom-margin trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Memory-pressure oom-margin windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Memory-pressure oom-margin minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requirePercent(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`Memory-pressure oom-margin ${name} must be between 0 and 100`);
  }
  return value;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Memory-pressure oom-margin ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => item.margin !== null && !item.invalid);
}

function metrics(evidence) {
  const values = observed(evidence).map((item) => item.margin);
  if (values.length === 0) return { mean: null, minimum: null, slope: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const usable = observed(evidence);
  const slope = usable.length < 2
    ? null : (usable.at(-1).margin - usable[0].margin) / (usable.length - 1);
  return { mean, minimum: Math.min(...values), slope };
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  criticalCount, narrowCount, slope, criticalCountThreshold, narrowCountThreshold,
  declineThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-margin-evidence';
  if (observedCount === 0) return 'no-observation';
  if (criticalCount >= criticalCountThreshold) return 'critical-margin';
  if (narrowCount >= narrowCountThreshold) return 'narrow-margin';
  if (slope !== null && slope <= -declineThreshold) return 'converging-margin';
  return 'safe-margin';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-margin-samples']);
  if (state === 'invalid-margin-evidence') return Object.freeze(['review-memory-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-memory-margin-observation']);
  if (state === 'critical-margin') return Object.freeze(['protect-critical-memory-margin', 'hold-destructive-actions']);
  if (state === 'narrow-margin') return Object.freeze(['protect-memory-margin', 'observe-next-sample']);
  if (state === 'converging-margin') return Object.freeze(['observe-memory-margin-decline']);
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
    throw new TypeError('Memory-pressure oom-margin clock must return a number');
  }
  return timestamp;
}

export function runMemoryPressureOomMarginTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  criticalMarginThreshold = 5,
  narrowMarginThreshold = 15,
  declineThreshold = 5,
  criticalCountThreshold = 1,
  narrowCountThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('Memory-pressure oom-margin samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredCritical = requirePercent('criticalMarginThreshold', criticalMarginThreshold);
  const requiredNarrow = requirePercent('narrowMarginThreshold', narrowMarginThreshold);
  const requiredDecline = requirePercent('declineThreshold', declineThreshold);
  const requiredCriticalCount = requireCount('criticalCountThreshold', criticalCountThreshold);
  const requiredNarrowCount = requireCount('narrowCountThreshold', narrowCountThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredCritical, requiredNarrow));
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const criticalCount = evidence.filter((item) => item.critical).length;
  const narrowCount = evidence.filter((item) => item.narrow).length;
  const measurements = metrics(evidence);
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    criticalCount, narrowCount, measurements.slope, requiredCriticalCount,
    requiredNarrowCount, requiredDecline);
  return Object.freeze({
    protocolVersion: 1,
    turbo: MEMORY_PRESSURE_OOM_MARGIN_TURBO_ID,
    turboVersion: MEMORY_PRESSURE_OOM_MARGIN_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount,
    invalidCount,
    criticalMarginThreshold: requiredCritical,
    narrowMarginThreshold: requiredNarrow,
    declineThreshold: requiredDecline,
    criticalCount,
    narrowCount,
    meanMargin: measurements.mean === null ? null : Math.round(measurements.mean * 10000) / 10000,
    minimumMargin: measurements.minimum,
    slope: measurements.slope === null ? null : Math.round(measurements.slope * 10000) / 10000,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
