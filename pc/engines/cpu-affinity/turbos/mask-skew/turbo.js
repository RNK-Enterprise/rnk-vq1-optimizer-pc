/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * CPU-affinity mask-skew turbo. It compares normalized affinity and isolation
 * coverage without applying masks, pinning processes, or changing policy.
 */

export const CPU_AFFINITY_MASK_TURBO_ID = 'cpu-affinity.mask-skew';
export const CPU_AFFINITY_MASK_TURBO_VERSION = 1;
export const CPU_AFFINITY_MASK_TRIGGERS = Object.freeze([
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

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function cpuList(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map(nonNegativeInteger).filter((item) => item !== null))]
    .sort((left, right) => left - right);
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('CPU-affinity mask-skew snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-affinity mask-skew requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-affinity mask-skew snapshot requires a CPU section');
  }
  return snapshot;
}

function overlapCount(left, right) {
  if (left === null || right === null) return null;
  return left.filter((item) => right.includes(item)).length;
}

function coverage(list, logicalCpus) {
  if (list === null || logicalCpus === null) return null;
  return Math.min(1, list.length / logicalCpus);
}

function evidenceOf(snapshot) {
  const cpu = requireSnapshot(snapshot).cpu;
  const logicalCpus = positiveInteger(cpu.logicalCpus);
  const affinity = cpuList(cpu.affinityCpus);
  const isolated = cpuList(cpu.isolatedCpus);
  return Object.freeze({
    logicalCpus,
    affinity,
    isolated,
    affinityCoverage: coverage(affinity, logicalCpus),
    isolationCoverage: coverage(isolated, logicalCpus),
    overlapCount: overlapCount(affinity, isolated)
  });
}

function requireTrigger(trigger) {
  if (!CPU_AFFINITY_MASK_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-affinity mask-skew trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-affinity mask-skew windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-affinity mask-skew minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCoverageThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('CPU-affinity mask-skew coverageThreshold must be between 0 and 1');
  }
  return threshold;
}

function requireOverlapThreshold(threshold) {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 64) {
    throw new RangeError('CPU-affinity mask-skew overlapThreshold must be an integer from 1 to 64');
  }
  return threshold;
}

function observed(evidence) {
  return evidence.filter((item) => item.logicalCpus !== null
    && (item.affinityCoverage !== null || item.isolationCoverage !== null));
}

function countPattern(evidence, selector) {
  return evidence.filter(selector).length;
}

function maximum(evidence, selector) {
  const values = evidence.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

function stateFor(sampleCount, minimumSamples, observedCount, overlapSamples,
  overlapThreshold, overIsolatedSamples, overIsolationThreshold, underCoveredSamples,
  underCoverageThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (overlapSamples >= overlapThreshold) return 'overlap-risk';
  if (overIsolatedSamples >= overlapThreshold && overIsolationThreshold > 0) return 'over-isolated';
  if (underCoveredSamples >= overlapThreshold && underCoverageThreshold >= 0) return 'under-covered';
  return 'stable-layout';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-affinity-samples']);
  if (state === 'no-observation') return Object.freeze(['request-affinity-topology-observation']);
  if (state === 'overlap-risk') return Object.freeze(['review-affinity-isolation-overlap']);
  if (state === 'over-isolated') return Object.freeze(['review-isolated-cpu-coverage']);
  if (state === 'under-covered') return Object.freeze(['review-affinity-cpu-coverage']);
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
    throw new TypeError('CPU-affinity mask-skew clock must return a number');
  }
  return timestamp;
}

export function runCpuAffinityMaskSkewTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  coverageThreshold = 0.5,
  overlapThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-affinity mask-skew samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredCoverage = requireCoverageThreshold(coverageThreshold);
  const requiredOverlap = requireOverlapThreshold(overlapThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usable = observed(evidence);
  const overlapSamples = countPattern(evidence, (item) => item.overlapCount !== null
    && item.overlapCount >= requiredOverlap);
  const overIsolatedSamples = countPattern(evidence, (item) => item.isolationCoverage !== null
    && item.isolationCoverage >= requiredCoverage);
  const underCoveredSamples = countPattern(evidence, (item) => item.affinityCoverage !== null
    && item.affinityCoverage < requiredCoverage);
  const state = stateFor(selected.length, requiredSamples, usable.length, overlapSamples,
    requiredOverlap, overIsolatedSamples, requiredCoverage, underCoveredSamples, requiredCoverage);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_AFFINITY_MASK_TURBO_ID,
    turboVersion: CPU_AFFINITY_MASK_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    coverageThreshold: requiredCoverage,
    overlapThreshold: requiredOverlap,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length,
    overlapSampleCount: overlapSamples,
    overIsolatedSampleCount: overIsolatedSamples,
    underCoveredSampleCount: underCoveredSamples,
    peakAffinityCoverage: maximum(usable, (item) => item.affinityCoverage),
    peakIsolationCoverage: maximum(usable, (item) => item.isolationCoverage),
    peakOverlapCount: maximum(usable, (item) => item.overlapCount),
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
