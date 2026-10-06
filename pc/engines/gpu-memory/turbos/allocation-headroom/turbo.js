/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * GPU allocation-headroom turbo. It measures bounded remaining VRAM without
 * evicting resources, changing allocation policy, or opening transport.
 */

export const GPU_ALLOCATION_HEADROOM_TURBO_ID = 'gpu-memory.allocation-headroom';
export const GPU_ALLOCATION_HEADROOM_TURBO_VERSION = 1;
export const GPU_ALLOCATION_HEADROOM_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('GPU allocation-headroom snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('GPU allocation-headroom requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.gpus)) {
    throw new TypeError('GPU allocation-headroom snapshot requires a GPU list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!GPU_ALLOCATION_HEADROOM_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU allocation-headroom trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('GPU allocation-headroom windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('GPU allocation-headroom minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`GPU allocation-headroom ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`GPU allocation-headroom ${name} must be between 0 and 100`);
  }
  return value;
}

function requireThresholds(criticalThreshold, lowThreshold) {
  if (lowThreshold <= criticalThreshold) {
    throw new RangeError('GPU allocation-headroom lowThreshold must exceed criticalThreshold');
  }
  return Object.freeze({ criticalThreshold, lowThreshold });
}

function headroomOf(gpu) {
  const capacity = nonNegative(gpu.vramBytes);
  const used = nonNegative(gpu.vramUsedBytes);
  if (capacity === null || used === null) return Object.freeze({ value: null, state: 'incomplete' });
  if (capacity === 0 || used > capacity) return Object.freeze({ value: null, state: 'invalid' });
  return Object.freeze({ value: ((capacity - used) / capacity) * 100, state: 'observed' });
}

function evidenceOf(snapshot, thresholds) {
  const source = requireSnapshot(snapshot);
  const records = source.gpus.filter(isRecord);
  if (records.length === 0) return Object.freeze({ state: 'no-gpu', value: null });
  if (source.capabilities?.gpuMemoryObservation === false) {
    return Object.freeze({ state: 'no-observation', value: null });
  }
  const values = records.map(headroomOf);
  if (values.some((item) => item.state === 'invalid')) {
    return Object.freeze({ state: 'invalid', value: null });
  }
  if (values.some((item) => item.state === 'incomplete')) {
    return Object.freeze({ state: 'incomplete', value: null });
  }
  const value = Math.min(...values.map((item) => item.value));
  const state = value <= thresholds.criticalThreshold ? 'critical' :
    value <= thresholds.lowThreshold ? 'low' : 'healthy';
  return Object.freeze({ state, value });
}

function stateFor(sampleCount, minimumSamples, evidence, invalidCount, incompleteCount,
  observedCount, criticalCount, lowCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-vram-evidence';
  if (incompleteCount > 0) return 'incomplete-vram-evidence';
  if (observedCount === 0 && evidence.every((item) => item.state === 'no-gpu')) return 'no-gpu';
  if (observedCount === 0) return 'no-observation';
  if (criticalCount >= persistenceThreshold) return 'critical-headroom-sustained';
  if (criticalCount > 0) return 'critical-headroom-observed';
  if (lowCount >= persistenceThreshold) return 'low-headroom-sustained';
  if (lowCount > 0) return 'low-headroom-observed';
  return 'healthy-headroom';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-vram-headroom-samples']);
  if (state === 'invalid-vram-evidence') return Object.freeze(['review-vram-counter-range']);
  if (state === 'incomplete-vram-evidence') return Object.freeze(['request-complete-vram-evidence']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-memory-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-vram-headroom-observation']);
  if (state === 'critical-headroom-sustained') {
    return Object.freeze(['protect-vram-headroom', 'hold-unapproved-memory-policy']);
  }
  if (state === 'critical-headroom-observed') return Object.freeze(['observe-next-vram-headroom-sample']);
  if (state === 'low-headroom-sustained') {
    return Object.freeze(['review-vram-allocation-pressure', 'hold-unapproved-memory-policy']);
  }
  if (state === 'low-headroom-observed') return Object.freeze(['observe-next-vram-headroom-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU allocation-headroom clock must return a number');
  return timestamp;
}

export function runGpuAllocationHeadroomTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  criticalThreshold = 5,
  lowThreshold = 20,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('GPU allocation-headroom samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const thresholds = requireThresholds(requireThreshold('criticalThreshold', criticalThreshold),
    requireThreshold('lowThreshold', lowThreshold));
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, thresholds));
  const invalidCount = evidence.filter((item) => item.state === 'invalid').length;
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noGpuCount = evidence.filter((item) => item.state === 'no-gpu').length;
  const observedCount = evidence.filter((item) => item.value !== null).length;
  const criticalCount = evidence.filter((item) => item.state === 'critical').length;
  const lowCount = evidence.filter((item) => item.state === 'low').length;
  const minimumHeadroom = observedCount === 0 ? null
    : Math.min(...evidence.map((item) => item.value).filter((value) => value !== null));
  const state = stateFor(selected.length, requiredSamples, evidence, invalidCount, incompleteCount,
    observedCount, criticalCount, lowCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: GPU_ALLOCATION_HEADROOM_TURBO_ID,
    turboVersion: GPU_ALLOCATION_HEADROOM_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    criticalThreshold: thresholds.criticalThreshold,
    lowThreshold: thresholds.lowThreshold,
    observedCount,
    invalidCount,
    incompleteCount,
    noGpuCount,
    criticalCount,
    lowCount,
    minimumHeadroom,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
