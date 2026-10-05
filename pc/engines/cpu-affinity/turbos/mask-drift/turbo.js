/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-affinity mask-drift turbo. It measures bounded changes in normalized
 * affinity and isolation lists without applying masks or changing policy.
 */

export const CPU_AFFINITY_DRIFT_TURBO_ID = 'cpu-affinity.mask-drift';
export const CPU_AFFINITY_DRIFT_TURBO_VERSION = 1;
export const CPU_AFFINITY_DRIFT_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
    throw new TypeError('CPU-affinity mask-drift snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-affinity mask-drift requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-affinity mask-drift snapshot requires a CPU section');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const cpu = requireSnapshot(snapshot).cpu;
  return Object.freeze({ affinity: cpuList(cpu.affinityCpus), isolated: cpuList(cpu.isolatedCpus) });
}

function listDistance(previous, current) {
  if (previous === null || current === null) return null;
  const union = [...new Set([...previous, ...current])];
  if (union.length === 0) return 0;
  const intersection = previous.filter((item) => current.includes(item)).length;
  return 1 - (intersection / union.length);
}

function driftOf(previous, current) {
  const affinityDrift = listDistance(previous.affinity, current.affinity);
  const isolationDrift = listDistance(previous.isolated, current.isolated);
  if (affinityDrift === null && isolationDrift === null) return null;
  if (affinityDrift === null) return isolationDrift;
  if (isolationDrift === null) return affinityDrift;
  return Math.max(affinityDrift, isolationDrift);
}

function requireTrigger(trigger) {
  if (!CPU_AFFINITY_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-affinity mask-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-affinity mask-drift windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-affinity mask-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireDriftThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('CPU-affinity mask-drift driftThreshold must be between 0 and 1');
  }
  return threshold;
}

function requireChangeThreshold(threshold) {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 64) {
    throw new RangeError('CPU-affinity mask-drift changeThreshold must be an integer from 1 to 64');
  }
  return threshold;
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maximum(values) {
  return values.length === 0 ? null : Math.max(...values);
}

function driftValues(evidence) {
  const values = [];
  for (let index = 1; index < evidence.length; index += 1) {
    const drift = driftOf(evidence[index - 1], evidence[index]);
    if (drift !== null) values.push(drift);
  }
  return values;
}

function stateFor(sampleCount, minimumSamples, observedCount, changeCount, changeThreshold,
  peakDrift, driftThreshold, meanDrift, meanThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (changeCount >= changeThreshold) return 'frequent-drift';
  if (peakDrift !== null && peakDrift >= driftThreshold) return 'high-drift';
  if (meanDrift !== null && meanDrift >= meanThreshold) return 'drift-watch';
  return 'stable-layout';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-affinity-samples']);
  if (state === 'no-observation') return Object.freeze(['request-affinity-drift-observation']);
  if (state === 'frequent-drift') return Object.freeze(['observe-affinity-change-duration']);
  if (state === 'high-drift') return Object.freeze(['review-affinity-list-change']);
  if (state === 'drift-watch') return Object.freeze(['observe-next-affinity-sample']);
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
    throw new TypeError('CPU-affinity mask-drift clock must return a number');
  }
  return timestamp;
}

export function runCpuAffinityMaskDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  driftThreshold = 0.5,
  changeThreshold = 3,
  meanThreshold = 0.25,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-affinity mask-drift samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredDrift = requireDriftThreshold(driftThreshold);
  const requiredChanges = requireChangeThreshold(changeThreshold);
  const requiredMean = requireDriftThreshold(meanThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const values = driftValues(evidence);
  const observedCount = evidence.filter((item) => item.affinity !== null || item.isolated !== null).length;
  const changeCount = values.filter((value) => value > 0).length;
  const peakDrift = maximum(values);
  const meanDrift = mean(values);
  const state = stateFor(selected.length, requiredSamples, observedCount, changeCount,
    requiredChanges, peakDrift, requiredDrift, meanDrift, requiredMean);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_AFFINITY_DRIFT_TURBO_ID,
    turboVersion: CPU_AFFINITY_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    driftThreshold: requiredDrift,
    changeThreshold: requiredChanges,
    meanThreshold: requiredMean,
    observedCount,
    unknownCount: selected.length - observedCount,
    comparisonCount: values.length,
    changeCount,
    peakDrift: peakDrift === null ? null : Math.round(peakDrift * 10000) / 10000,
    meanDrift: meanDrift === null ? null : Math.round(meanDrift * 10000) / 10000,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
