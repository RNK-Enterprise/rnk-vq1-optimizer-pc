/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * GPU multi-gpu-skew turbo. It measures bounded adapter utilization imbalance
 * without changing GPU policy, drivers, files, or opening transport.
 */

export const GPU_MULTI_GPU_SKEW_TURBO_ID = 'gpu-utilization.multi-gpu-skew';
export const GPU_MULTI_GPU_SKEW_TURBO_VERSION = 1;
export const GPU_MULTI_GPU_SKEW_TRIGGERS = Object.freeze([
  'install.preflight',
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

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('GPU multi-gpu-skew snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('GPU multi-gpu-skew requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.gpus)) throw new TypeError('GPU multi-gpu-skew snapshot requires a GPU list');
  return snapshot;
}

function evidenceOf(snapshot, skewThreshold) {
  const source = requireSnapshot(snapshot);
  const records = source.gpus.filter(isRecord);
  if (records.length === 0) return Object.freeze({ skew: null, state: 'no-gpu', invalid: false });
  const values = records.map((gpu) => percentOf(gpu.utilizationPercent));
  const invalid = values.some((item) => item.invalid);
  if (invalid) return Object.freeze({ skew: null, state: 'invalid', invalid: true });
  const usable = values.map((item) => item.value).filter((value) => value !== null);
  if (usable.length === 0) return Object.freeze({ skew: null, state: 'unknown', invalid: false });
  const skew = Math.max(...usable) - Math.min(...usable);
  return Object.freeze({ skew, state: skew > skewThreshold ? 'skewed' : 'balanced', invalid: false });
}

function requireTrigger(trigger) {
  if (!GPU_MULTI_GPU_SKEW_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU multi-gpu-skew trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('GPU multi-gpu-skew windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('GPU multi-gpu-skew minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requirePercentThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('GPU multi-gpu-skew skewThreshold must be between 0 and 100');
  }
  return value;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`GPU multi-gpu-skew ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => item.state === 'skewed' || item.state === 'balanced');
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  noGpuCount, skewCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-skew-evidence';
  if (observedCount === 0 && noGpuCount > 0) return 'no-gpu';
  if (observedCount === 0) return 'no-observation';
  if (skewCount >= persistenceThreshold) return 'sustained-skew';
  if (skewCount > 0) return 'skew-observed';
  return 'balanced-gpu-layout';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-gpu-skew-samples']);
  if (state === 'invalid-skew-evidence') return Object.freeze(['review-gpu-utilization-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-gpu-skew-observation']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-controls-disabled']);
  if (state === 'sustained-skew') return Object.freeze(['review-gpu-workload-distribution', 'hold-unapproved-gpu-policy']);
  if (state === 'skew-observed') return Object.freeze(['observe-next-gpu-layout-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU multi-gpu-skew clock must return a number');
  return timestamp;
}

export function runGpuMultiGpuSkewTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  skewThreshold = 25,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('GPU multi-gpu-skew samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredSkew = requirePercentThreshold(skewThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredSkew));
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const noGpuCount = evidence.filter((item) => item.state === 'no-gpu' && !item.invalid).length;
  const skewCount = evidence.filter((item) => item.state === 'skewed').length;
  const balancedCount = evidence.filter((item) => item.state === 'balanced').length;
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    noGpuCount, skewCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: GPU_MULTI_GPU_SKEW_TURBO_ID,
    turboVersion: GPU_MULTI_GPU_SKEW_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount - noGpuCount,
    invalidCount,
    noGpuCount,
    skewCount,
    balancedCount,
    skewThreshold: requiredSkew,
    persistenceThreshold: requiredPersistence,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
