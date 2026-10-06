/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * GPU occupancy-drift turbo. It measures bounded VRAM usage movement without
 * evicting resources, changing allocation policy, or opening transport.
 */

export const GPU_OCCUPANCY_DRIFT_TURBO_ID = 'gpu-memory.occupancy-drift';
export const GPU_OCCUPANCY_DRIFT_TURBO_VERSION = 1;
export const GPU_OCCUPANCY_DRIFT_TRIGGERS = Object.freeze([
  'install.preflight',
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

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('GPU occupancy-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('GPU occupancy-drift requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.gpus)) {
    throw new TypeError('GPU occupancy-drift snapshot requires a GPU list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!GPU_OCCUPANCY_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU occupancy-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('GPU occupancy-drift windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('GPU occupancy-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`GPU occupancy-drift ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('GPU occupancy-drift deltaThreshold must be between 0 and 100');
  }
  return value;
}

function occupancyOf(gpu) {
  const capacity = nonNegative(gpu.vramBytes);
  const used = nonNegative(gpu.vramUsedBytes);
  if (capacity === null || used === null) return Object.freeze({ value: null, state: 'incomplete' });
  if (capacity === 0 || used > capacity) return Object.freeze({ value: null, state: 'invalid' });
  return Object.freeze({ value: (used / capacity) * 100, state: 'observed' });
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const records = source.gpus.filter(isRecord);
  if (records.length === 0) return Object.freeze({ state: 'no-gpu', value: null });
  if (source.capabilities?.gpuMemoryObservation === false) {
    return Object.freeze({ state: 'no-observation', value: null });
  }
  const values = records.map(occupancyOf);
  if (values.some((item) => item.state === 'invalid')) {
    return Object.freeze({ state: 'invalid', value: null });
  }
  if (values.some((item) => item.state === 'incomplete')) {
    return Object.freeze({ state: 'incomplete', value: null });
  }
  return Object.freeze({
    state: 'observed',
    value: Math.max(...values.map((item) => item.value))
  });
}

function movement(evidence, deltaThreshold) {
  let deltaCount = 0;
  let comparisonCount = 0;
  let maximumDelta = 0;
  let previous = null;
  for (const current of evidence) {
    if (current.value === null) {
      previous = null;
      continue;
    }
    if (previous !== null) {
      const delta = Math.abs(current.value - previous);
      comparisonCount += 1;
      maximumDelta = Math.max(maximumDelta, delta);
      if (delta >= deltaThreshold) deltaCount += 1;
    }
    previous = current.value;
  }
  return { deltaCount, comparisonCount, maximumDelta };
}

function stateFor(sampleCount, minimumSamples, evidence, invalidCount, incompleteCount,
  observedCount, deltaCount, changeThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-vram-evidence';
  if (incompleteCount > 0) return 'incomplete-vram-evidence';
  if (observedCount === 0 && evidence.every((item) => item.state === 'no-gpu')) return 'no-gpu';
  if (observedCount === 0) return 'no-observation';
  if (deltaCount >= changeThreshold) return 'sustained-occupancy-drift';
  if (deltaCount > 0) return 'occupancy-drift-observed';
  return 'stable-occupancy';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-vram-occupancy-samples']);
  if (state === 'invalid-vram-evidence') return Object.freeze(['review-vram-counter-range']);
  if (state === 'incomplete-vram-evidence') return Object.freeze(['request-complete-vram-evidence']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-memory-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-vram-occupancy-observation']);
  if (state === 'sustained-occupancy-drift') {
    return Object.freeze(['review-vram-workload-pattern', 'hold-unapproved-memory-policy']);
  }
  if (state === 'occupancy-drift-observed') return Object.freeze(['observe-next-vram-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU occupancy-drift clock must return a number');
  return timestamp;
}

export function runGpuOccupancyDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  deltaThreshold = 10,
  changeThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('GPU occupancy-drift samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredDelta = requireThreshold(deltaThreshold);
  const requiredChanges = requireCount('changeThreshold', changeThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const invalidCount = evidence.filter((item) => item.state === 'invalid').length;
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noGpuCount = evidence.filter((item) => item.state === 'no-gpu').length;
  const observedCount = evidence.filter((item) => item.value !== null).length;
  const trend = movement(evidence, requiredDelta);
  const state = stateFor(selected.length, requiredSamples, evidence, invalidCount, incompleteCount,
    observedCount, trend.deltaCount, requiredChanges);
  return Object.freeze({
    protocolVersion: 1,
    turbo: GPU_OCCUPANCY_DRIFT_TURBO_ID,
    turboVersion: GPU_OCCUPANCY_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount,
    invalidCount,
    incompleteCount,
    noGpuCount,
    deltaCount: trend.deltaCount,
    comparisonCount: trend.comparisonCount,
    maximumDelta: trend.maximumDelta,
    deltaThreshold: requiredDelta,
    changeThreshold: requiredChanges,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
