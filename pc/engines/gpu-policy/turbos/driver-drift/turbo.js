/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * GPU driver-drift turbo. It compares bounded driver evidence without
 * changing drivers, GPU policy, files, or opening transport.
 */

export const GPU_DRIVER_DRIFT_TURBO_ID = 'gpu-policy.driver-drift';
export const GPU_DRIVER_DRIFT_TURBO_VERSION = 1;
export const GPU_DRIVER_DRIFT_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const DOCUMENTED_MARKERS = Object.freeze(['nouveau', 'amdgpu', 'i915', 'nvidia']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function driverClass(driver) {
  if (driver === null) return 'unknown';
  return DOCUMENTED_MARKERS.some((marker) => driver.toLowerCase().includes(marker))
    ? 'documented' : 'vendor-specific';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('GPU driver-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('GPU driver-drift requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.gpus)) throw new TypeError('GPU driver-drift snapshot requires a GPU list');
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const records = source.gpus.filter(isRecord);
  if (records.length === 0) return Object.freeze({ state: 'no-gpu', fingerprint: null });
  const drivers = records.map((gpu) => text(gpu.driver));
  const classes = drivers.map(driverClass);
  if (classes.includes('unknown')) return Object.freeze({ state: 'incomplete', fingerprint: null });
  const state = classes.includes('vendor-specific') ? 'vendor-specific' : 'documented';
  const fingerprint = drivers.slice().sort().join('|');
  return Object.freeze({ state, fingerprint });
}

function requireTrigger(trigger) {
  if (!GPU_DRIVER_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU driver-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('GPU driver-drift windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('GPU driver-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`GPU driver-drift ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function movement(evidence) {
  let changeCount = 0;
  let reviewCount = 0;
  let comparisonCount = 0;
  let previous = null;
  for (const current of evidence) {
    if (current.fingerprint === null) {
      previous = null;
      continue;
    }
    if (previous !== null) {
      comparisonCount += 1;
      if (current.fingerprint !== previous.fingerprint) changeCount += 1;
      if (current.state === 'vendor-specific') reviewCount += 1;
    }
    previous = current;
  }
  return { changeCount, reviewCount, comparisonCount };
}

function stateFor(sampleCount, minimumSamples, noGpuCount, incompleteCount,
  observedCount, changeCount, reviewCount, changeThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (noGpuCount === sampleCount) return 'no-gpu';
  if (observedCount === 0) return 'no-observation';
  if (incompleteCount > 0) return 'incomplete-driver-evidence';
  if (changeCount >= changeThreshold) return 'driver-drift';
  if (reviewCount > 0) return 'vendor-specific-driver';
  return 'documented-driver-stable';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-driver-samples']);
  if (state === 'no-gpu') return Object.freeze(['keep-gpu-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-driver-observation']);
  if (state === 'incomplete-driver-evidence') return Object.freeze(['request-complete-driver-evidence']);
  if (state === 'driver-drift') return Object.freeze(['review-driver-change', 'hold-driver-automation']);
  if (state === 'vendor-specific-driver') return Object.freeze(['review-documented-driver-controls-without-change']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU driver-drift clock must return a number');
  return timestamp;
}

export function runGpuDriverDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  changeThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('GPU driver-drift samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredChanges = requireCount('changeThreshold', changeThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const noGpuCount = evidence.filter((item) => item.state === 'no-gpu').length;
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const observedCount = evidence.filter((item) => item.fingerprint !== null).length;
  const trend = movement(evidence);
  const state = stateFor(selected.length, requiredSamples, noGpuCount, incompleteCount,
    observedCount, trend.changeCount, trend.reviewCount, requiredChanges);
  return Object.freeze({
    protocolVersion: 1,
    turbo: GPU_DRIVER_DRIFT_TURBO_ID,
    turboVersion: GPU_DRIVER_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount,
    unknownCount: selected.length - observedCount - noGpuCount,
    invalidCount: 0,
    noGpuCount,
    incompleteCount,
    changeCount: trend.changeCount,
    reviewCount: trend.reviewCount,
    comparisonCount: trend.comparisonCount,
    changeThreshold: requiredChanges,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
