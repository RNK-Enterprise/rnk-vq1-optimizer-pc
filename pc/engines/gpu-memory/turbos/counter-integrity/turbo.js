/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * GPU counter-integrity turbo. It compares bounded capacity, used, and free
 * VRAM counters without changing allocation policy or opening transport.
 */

export const GPU_COUNTER_INTEGRITY_TURBO_ID = 'gpu-memory.counter-integrity';
export const GPU_COUNTER_INTEGRITY_TURBO_VERSION = 1;
export const GPU_COUNTER_INTEGRITY_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('GPU counter-integrity snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('GPU counter-integrity requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.gpus)) {
    throw new TypeError('GPU counter-integrity snapshot requires a GPU list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!GPU_COUNTER_INTEGRITY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU counter-integrity trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('GPU counter-integrity windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('GPU counter-integrity minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`GPU counter-integrity ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireTolerance(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('GPU counter-integrity tolerancePercent must be between 0 and 100');
  }
  return value;
}

function counterOf(gpu, tolerancePercent) {
  const capacity = nonNegative(gpu.vramBytes);
  const used = nonNegative(gpu.vramUsedBytes);
  const free = nonNegative(gpu.vramFreeBytes);
  if (capacity === null || used === null || free === null) {
    return Object.freeze({ state: 'incomplete', errorPercent: null });
  }
  if (capacity === 0 || used > capacity || free > capacity) {
    return Object.freeze({ state: 'invalid', errorPercent: null });
  }
  const errorPercent = Math.abs((used + free - capacity) / capacity) * 100;
  return Object.freeze({
    state: errorPercent > tolerancePercent ? 'inconsistent' : 'consistent',
    errorPercent
  });
}

function evidenceOf(snapshot, tolerancePercent) {
  const source = requireSnapshot(snapshot);
  const records = source.gpus.filter(isRecord);
  if (records.length === 0) return Object.freeze({ state: 'no-gpu', errorPercent: null });
  if (source.capabilities?.gpuMemoryObservation === false) {
    return Object.freeze({ state: 'no-observation', errorPercent: null });
  }
  const counters = records.map((gpu) => counterOf(gpu, tolerancePercent));
  if (counters.some((item) => item.state === 'invalid')) {
    return Object.freeze({ state: 'invalid', errorPercent: null });
  }
  if (counters.some((item) => item.state === 'incomplete')) {
    return Object.freeze({ state: 'incomplete', errorPercent: null });
  }
  const errorPercent = Math.max(...counters.map((item) => item.errorPercent));
  const state = counters.some((item) => item.state === 'inconsistent') ? 'inconsistent' : 'consistent';
  return Object.freeze({ state, errorPercent });
}

function stateFor(sampleCount, minimumSamples, evidence, invalidCount, incompleteCount,
  observedCount, inconsistentCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-vram-evidence';
  if (incompleteCount > 0) return 'incomplete-vram-evidence';
  if (observedCount === 0 && evidence.every((item) => item.state === 'no-gpu')) return 'no-gpu';
  if (observedCount === 0) return 'no-observation';
  if (inconsistentCount >= persistenceThreshold) return 'inconsistent-counters-sustained';
  if (inconsistentCount > 0) return 'inconsistent-counters-observed';
  return 'consistent-counters';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-vram-counter-samples']);
  if (state === 'invalid-vram-evidence') return Object.freeze(['review-vram-counter-range']);
  if (state === 'incomplete-vram-evidence') return Object.freeze(['request-complete-vram-counters']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-memory-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-vram-counter-observation']);
  if (state === 'inconsistent-counters-sustained') {
    return Object.freeze(['review-vram-counter-source', 'hold-unapproved-memory-policy']);
  }
  if (state === 'inconsistent-counters-observed') return Object.freeze(['observe-next-vram-counter-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU counter-integrity clock must return a number');
  return timestamp;
}

export function runGpuCounterIntegrityTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  tolerancePercent = 5,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('GPU counter-integrity samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredTolerance = requireTolerance(tolerancePercent);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredTolerance));
  const invalidCount = evidence.filter((item) => item.state === 'invalid').length;
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noGpuCount = evidence.filter((item) => item.state === 'no-gpu').length;
  const observedCount = evidence.filter((item) => item.errorPercent !== null).length;
  const inconsistentCount = evidence.filter((item) => item.state === 'inconsistent').length;
  const consistentCount = evidence.filter((item) => item.state === 'consistent').length;
  const maximumErrorPercent = observedCount === 0 ? null
    : Math.max(...evidence.map((item) => item.errorPercent).filter((value) => value !== null));
  const state = stateFor(selected.length, requiredSamples, evidence, invalidCount, incompleteCount,
    observedCount, inconsistentCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: GPU_COUNTER_INTEGRITY_TURBO_ID,
    turboVersion: GPU_COUNTER_INTEGRITY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    tolerancePercent: requiredTolerance,
    observedCount,
    invalidCount,
    incompleteCount,
    noGpuCount,
    inconsistentCount,
    consistentCount,
    maximumErrorPercent,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
