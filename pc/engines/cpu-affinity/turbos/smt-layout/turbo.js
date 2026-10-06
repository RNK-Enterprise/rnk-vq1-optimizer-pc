/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * CPU-affinity SMT-layout turbo. It observes logical-to-physical CPU ratios
 * without changing affinity, masks, or scheduler state.
 */

export const CPU_AFFINITY_SMT_TURBO_ID = 'cpu-affinity.smt-layout';
export const CPU_AFFINITY_SMT_TURBO_VERSION = 1;
export const CPU_AFFINITY_SMT_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('CPU-affinity smt-layout snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-affinity smt-layout requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-affinity smt-layout snapshot requires a CPU section');
  }
  return snapshot;
}

function ratioOf(snapshot) {
  const cpu = requireSnapshot(snapshot).cpu;
  const physical = positiveInteger(cpu.physicalCpus);
  const logical = positiveInteger(cpu.logicalCpus);
  if (physical === null || logical === null) return null;
  return Object.freeze({
    physical,
    logical,
    ratio: logical / physical,
    inconsistent: physical > logical
  });
}

function requireTrigger(trigger) {
  if (!CPU_AFFINITY_SMT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-affinity smt-layout trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-affinity smt-layout windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-affinity smt-layout minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireRatioThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 8) {
    throw new RangeError('CPU-affinity smt-layout ratioThreshold must be between 1 and 8');
  }
  return threshold;
}

function requireRangeThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 8) {
    throw new RangeError('CPU-affinity smt-layout rangeThreshold must be between 0 and 8');
  }
  return threshold;
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maximum(values) {
  return values.length === 0 ? null : Math.max(...values);
}

function minimum(values) {
  return Math.min(...values);
}

function stateFor(sampleCount, minimumSamples, observedCount, inconsistentCount,
  heavyCount, ratioThreshold, ratioRange, rangeThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (inconsistentCount > 0) return 'inconsistent-layout';
  if (heavyCount > 0 && ratioThreshold >= 1) return 'heavy-smt';
  if (ratioRange >= rangeThreshold && rangeThreshold > 0) return 'ratio-shift';
  return 'stable-smt';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-smt-samples']);
  if (state === 'no-observation') return Object.freeze(['request-smt-topology-observation']);
  if (state === 'inconsistent-layout') return Object.freeze(['reject-unverified-smt-layout']);
  if (state === 'heavy-smt') return Object.freeze(['preserve-os-smt-layout']);
  if (state === 'ratio-shift') return Object.freeze(['observe-next-smt-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('CPU-affinity smt-layout clock must return a number');
  return timestamp;
}

export function runCpuAffinitySmtLayoutTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  ratioThreshold = 2,
  rangeThreshold = 0.5,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-affinity smt-layout samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredRatio = requireRatioThreshold(ratioThreshold);
  const requiredRange = requireRangeThreshold(rangeThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(ratioOf);
  const observed = evidence.filter((item) => item !== null);
  const ratios = observed.map((item) => item.ratio);
  const inconsistentCount = observed.filter((item) => item.inconsistent).length;
  const heavyCount = ratios.filter((ratio) => ratio >= requiredRatio).length;
  const ratioRange = maximum(ratios) === null ? 0 : maximum(ratios) - minimum(ratios);
  const state = stateFor(selected.length, requiredSamples, observed.length, inconsistentCount,
    heavyCount, requiredRatio, ratioRange, requiredRange);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_AFFINITY_SMT_TURBO_ID,
    turboVersion: CPU_AFFINITY_SMT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    ratioThreshold: requiredRatio,
    rangeThreshold: requiredRange,
    observedCount: observed.length,
    unknownCount: selected.length - observed.length,
    inconsistentCount,
    heavySampleCount: heavyCount,
    peakRatio: maximum(ratios),
    meanRatio: mean(ratios),
    ratioRange: Math.round(ratioRange * 10000) / 10000,
    state,
    confidence: confidence(selected.length, observed.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
