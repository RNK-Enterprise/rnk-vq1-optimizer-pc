/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * CPU-affinity topology-drift turbo. It observes bounded CPU topology changes
 * without pinning processes, applying masks, or changing system state.
 */

export const CPU_AFFINITY_TOPOLOGY_TURBO_ID = 'cpu-affinity.topology-drift';
export const CPU_AFFINITY_TOPOLOGY_TURBO_VERSION = 1;
export const CPU_AFFINITY_TOPOLOGY_TRIGGERS = Object.freeze([
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
    throw new TypeError('CPU-affinity topology-drift snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-affinity topology-drift requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-affinity topology-drift snapshot requires a CPU section');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const cpu = requireSnapshot(snapshot).cpu;
  const physical = positiveInteger(cpu.physicalCpus);
  const logical = positiveInteger(cpu.logicalCpus);
  const sockets = positiveInteger(cpu.sockets);
  if (physical === null || logical === null || sockets === null) return null;
  return Object.freeze({
    physical,
    logical,
    sockets,
    inconsistent: physical > logical,
    signature: `${physical}:${logical}:${sockets}`
  });
}

function requireTrigger(trigger) {
  if (!CPU_AFFINITY_TOPOLOGY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-affinity topology-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-affinity topology-drift windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-affinity topology-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireChangeThreshold(threshold) {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 64) {
    throw new RangeError('CPU-affinity topology-drift changeThreshold must be an integer from 1 to 64');
  }
  return threshold;
}

function requireRateThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('CPU-affinity topology-drift changeRateThreshold must be between 0 and 1');
  }
  return threshold;
}

function observed(evidence) {
  return evidence.filter((item) => item !== null);
}

function transitions(evidence) {
  let count = 0;
  let comparisons = 0;
  for (let index = 1; index < evidence.length; index += 1) {
    if (evidence[index] !== null && evidence[index - 1] !== null) {
      comparisons += 1;
      if (evidence[index].signature !== evidence[index - 1].signature) count += 1;
    }
  }
  return { count, comparisons };
}

function stateFor(sampleCount, minimumSamples, observedCount, inconsistentCount,
  changeCount, changeThreshold, changeRate, changeRateThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (inconsistentCount > 0) return 'inconsistent-topology';
  if (changeCount >= changeThreshold) return 'frequent-drift';
  if (changeRate >= changeRateThreshold) return 'topology-watch';
  return 'stable-topology';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-topology-samples']);
  if (state === 'no-observation') return Object.freeze(['request-cpu-topology-observation']);
  if (state === 'inconsistent-topology') return Object.freeze(['reject-unverified-topology-change']);
  if (state === 'frequent-drift') return Object.freeze(['observe-topology-change-duration']);
  if (state === 'topology-watch') return Object.freeze(['observe-next-topology-sample']);
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
    throw new TypeError('CPU-affinity topology-drift clock must return a number');
  }
  return timestamp;
}

export function runCpuAffinityTopologyDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  changeThreshold = 3,
  changeRateThreshold = 0.5,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-affinity topology-drift samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredChanges = requireChangeThreshold(changeThreshold);
  const requiredRate = requireRateThreshold(changeRateThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usable = observed(evidence);
  const { count: changeCount, comparisons } = transitions(evidence);
  const inconsistentCount = usable.filter((item) => item.inconsistent).length;
  const changeRate = comparisons === 0 ? 0 : changeCount / comparisons;
  const state = stateFor(selected.length, requiredSamples, usable.length, inconsistentCount,
    changeCount, requiredChanges, changeRate, requiredRate);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_AFFINITY_TOPOLOGY_TURBO_ID,
    turboVersion: CPU_AFFINITY_TOPOLOGY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    changeThreshold: requiredChanges,
    changeRateThreshold: requiredRate,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length,
    comparisonCount: comparisons,
    changeCount,
    changeRate: Math.round(changeRate * 10000) / 10000,
    inconsistentCount,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
