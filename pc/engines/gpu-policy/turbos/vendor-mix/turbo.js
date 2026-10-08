/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * GPU vendor-mix turbo. It measures bounded adapter-vendor composition
 * without changing GPU policy, drivers, files, or opening transport.
 */

export const GPU_VENDOR_MIX_TURBO_ID = 'gpu-policy.vendor-mix';
export const GPU_VENDOR_MIX_TURBO_VERSION = 1;
export const GPU_VENDOR_MIX_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const KNOWN_VENDORS = Object.freeze(['nvidia', 'amd', 'ati', 'intel']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function vendorKey(value) {
  const normalized = value.toLowerCase();
  if (KNOWN_VENDORS.includes(normalized)) return normalized;
  if (normalized.includes('nvidia')) return 'nvidia';
  if (normalized.includes('amd')) return 'amd';
  if (normalized.includes('ati')) return 'ati';
  if (normalized.includes('intel')) return 'intel';
  return 'vendor-specific';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('GPU vendor-mix snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('GPU vendor-mix requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.gpus)) {
    throw new TypeError('GPU vendor-mix snapshot requires a GPU list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!GPU_VENDOR_MIX_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU vendor-mix trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('GPU vendor-mix windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('GPU vendor-mix minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`GPU vendor-mix ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const records = source.gpus.filter(isRecord);
  if (records.length === 0) {
    return Object.freeze({ state: 'no-gpu', vendors: Object.freeze([]), invalid: false });
  }
  const names = records.map((gpu) => text(gpu.vendor));
  if (names.some((name) => name === null)) {
    return Object.freeze({ state: 'incomplete', vendors: Object.freeze([]), invalid: false });
  }
  const vendors = [...new Set(names.map(vendorKey))].sort();
  const state = vendors.includes('vendor-specific') ? 'vendor-specific' :
    vendors.length > 1 ? 'mixed' : 'homogeneous';
  return Object.freeze({ state, vendors: Object.freeze(vendors), invalid: false });
}

function observed(evidence) {
  return evidence.filter((item) => item.state === 'mixed' || item.state === 'homogeneous'
    || item.state === 'vendor-specific');
}

function stateFor(sampleCount, minimumSamples, evidence, mixedCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'incomplete')) return 'incomplete-vendor-evidence';
  if (evidence.every((item) => item.state === 'no-gpu')) return 'no-gpu';
  if (evidence.some((item) => item.state === 'no-gpu')) return 'no-observation';
  if (evidence.some((item) => item.state === 'vendor-specific')) return 'vendor-specific-layout';
  if (mixedCount >= persistenceThreshold) return 'sustained-mixed-vendor-layout';
  if (mixedCount > 0) return 'mixed-vendor-observed';
  return 'homogeneous-vendor-layout';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-gpu-vendor-samples']);
  if (state === 'no-observation') return Object.freeze(['request-gpu-vendor-observation']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-controls-disabled']);
  if (state === 'incomplete-vendor-evidence') return Object.freeze(['request-complete-gpu-vendor-evidence']);
  if (state === 'vendor-specific-layout') return Object.freeze(['review-documented-gpu-vendor-controls']);
  if (state === 'sustained-mixed-vendor-layout') {
    return Object.freeze(['review-gpu-workload-distribution', 'hold-unapproved-gpu-policy']);
  }
  if (state === 'mixed-vendor-observed') return Object.freeze(['observe-next-gpu-vendor-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU vendor-mix clock must return a number');
  return timestamp;
}

export function runGpuVendorMixTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('GPU vendor-mix samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usable = observed(evidence);
  const mixedCount = evidence.filter((item) => item.state === 'mixed').length;
  const homogeneousCount = evidence.filter((item) => item.state === 'homogeneous').length;
  const vendorSpecificCount = evidence.filter((item) => item.state === 'vendor-specific').length;
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noGpuCount = evidence.filter((item) => item.state === 'no-gpu').length;
  const state = stateFor(selected.length, requiredSamples, evidence, mixedCount, requiredPersistence);
  const vendors = [...new Set(evidence.flatMap((item) => item.vendors))].sort();
  return Object.freeze({
    protocolVersion: 1,
    turbo: GPU_VENDOR_MIX_TURBO_ID,
    turboVersion: GPU_VENDOR_MIX_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    observedCount: usable.length,
    mixedCount,
    homogeneousCount,
    vendorSpecificCount,
    incompleteCount,
    noGpuCount,
    vendors: Object.freeze(vendors),
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
