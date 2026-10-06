/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * GPU capacity-skew turbo. It measures bounded adapter VRAM asymmetry without
 * changing allocation policy, drivers, files, or opening transport.
 */

export const GPU_CAPACITY_SKEW_TURBO_ID = 'gpu-memory.capacity-skew';
export const GPU_CAPACITY_SKEW_TURBO_VERSION = 1;
export const GPU_CAPACITY_SKEW_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('GPU capacity-skew snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('GPU capacity-skew requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.gpus)) {
    throw new TypeError('GPU capacity-skew snapshot requires a GPU list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!GPU_CAPACITY_SKEW_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU capacity-skew trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('GPU capacity-skew windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('GPU capacity-skew minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`GPU capacity-skew ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('GPU capacity-skew skewThreshold must be between 0 and 100');
  }
  return value;
}

function evidenceOf(snapshot, skewThreshold) {
  const source = requireSnapshot(snapshot);
  const records = source.gpus.filter(isRecord);
  if (records.length === 0) return Object.freeze({ state: 'no-gpu', skew: null, capacity: null });
  if (source.capabilities?.gpuMemoryObservation === false) {
    return Object.freeze({ state: 'no-observation', skew: null, capacity: null });
  }
  const capacities = records.map((gpu) => nonNegative(gpu.vramBytes));
  if (capacities.some((capacity) => capacity === null)) {
    return Object.freeze({ state: 'incomplete', skew: null, capacity: null });
  }
  if (capacities.some((capacity) => capacity === 0)) {
    return Object.freeze({ state: 'invalid', skew: null, capacity: null });
  }
  const maximum = Math.max(...capacities);
  const minimum = Math.min(...capacities);
  const skew = ((maximum - minimum) / maximum) * 100;
  return Object.freeze({
    state: skew >= skewThreshold ? 'skewed' : 'balanced',
    skew,
    capacity: maximum
  });
}

function stateFor(sampleCount, minimumSamples, evidence, invalidCount, incompleteCount,
  observedCount, skewCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-vram-evidence';
  if (incompleteCount > 0) return 'incomplete-vram-evidence';
  if (observedCount === 0 && evidence.every((item) => item.state === 'no-gpu')) return 'no-gpu';
  if (observedCount === 0) return 'no-observation';
  if (skewCount >= persistenceThreshold) return 'sustained-capacity-skew';
  if (skewCount > 0) return 'capacity-skew-observed';
  return 'balanced-capacity';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-vram-capacity-samples']);
  if (state === 'invalid-vram-evidence') return Object.freeze(['review-vram-capacity-range']);
  if (state === 'incomplete-vram-evidence') return Object.freeze(['request-complete-vram-capacity']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-memory-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-vram-capacity-observation']);
  if (state === 'sustained-capacity-skew') {
    return Object.freeze(['review-multi-gpu-capacity-layout', 'hold-unapproved-memory-policy']);
  }
  if (state === 'capacity-skew-observed') return Object.freeze(['observe-next-vram-capacity-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU capacity-skew clock must return a number');
  return timestamp;
}

export function runGpuCapacitySkewTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  skewThreshold = 25,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('GPU capacity-skew samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredSkew = requireThreshold(skewThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredSkew));
  const invalidCount = evidence.filter((item) => item.state === 'invalid').length;
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noGpuCount = evidence.filter((item) => item.state === 'no-gpu').length;
  const observedCount = evidence.filter((item) => item.skew !== null).length;
  const skewCount = evidence.filter((item) => item.state === 'skewed').length;
  const balancedCount = evidence.filter((item) => item.state === 'balanced').length;
  const maximumSkew = observedCount === 0 ? null
    : Math.max(...evidence.map((item) => item.skew).filter((value) => value !== null));
  const state = stateFor(selected.length, requiredSamples, evidence, invalidCount, incompleteCount,
    observedCount, skewCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: GPU_CAPACITY_SKEW_TURBO_ID,
    turboVersion: GPU_CAPACITY_SKEW_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    skewThreshold: requiredSkew,
    observedCount,
    invalidCount,
    incompleteCount,
    noGpuCount,
    skewCount,
    balancedCount,
    maximumSkew,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
