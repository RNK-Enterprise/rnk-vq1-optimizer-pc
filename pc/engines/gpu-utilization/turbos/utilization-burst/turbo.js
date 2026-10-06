/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * GPU utilization-burst turbo. It measures bounded utilization bursts without
 * changing GPU policy, drivers, files, or opening transport.
 */

export const GPU_UTILIZATION_BURST_TURBO_ID = 'gpu-utilization.utilization-burst';
export const GPU_UTILIZATION_BURST_TURBO_VERSION = 1;
export const GPU_UTILIZATION_BURST_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('GPU utilization-burst snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('GPU utilization-burst requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.gpus)) {
    throw new TypeError('GPU utilization-burst snapshot requires a GPU list');
  }
  return snapshot;
}

function evidenceOf(snapshot, burstThreshold) {
  const source = requireSnapshot(snapshot);
  const records = source.gpus.filter(isRecord);
  const values = records.map((gpu) => percentOf(gpu.utilizationPercent));
  const invalid = values.some((item) => item.invalid);
  const usable = values.map((item) => item.value).filter((value) => value !== null);
  if (invalid) return Object.freeze({ utilization: null, state: 'invalid', invalid: true });
  if (usable.length === 0) return Object.freeze({ utilization: null, state: 'unknown', invalid: false });
  const utilization = Math.max(...usable);
  return Object.freeze({
    utilization,
    state: utilization >= burstThreshold ? 'burst' : 'normal',
    invalid: false
  });
}

function requireTrigger(trigger) {
  if (!GPU_UTILIZATION_BURST_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU utilization-burst trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('GPU utilization-burst windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('GPU utilization-burst minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requirePercentThreshold(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`GPU utilization-burst ${name} must be between 0 and 100`);
  }
  return value;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`GPU utilization-burst ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => item.state === 'burst' || item.state === 'normal');
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  burstCount, burstThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-utilization-evidence';
  if (observedCount === 0) return 'no-observation';
  if (burstCount >= burstThreshold) return 'sustained-burst';
  if (burstCount > 0) return 'burst-observed';
  return 'normal-utilization';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-gpu-utilization-samples']);
  if (state === 'invalid-utilization-evidence') return Object.freeze(['review-gpu-utilization-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-gpu-utilization-observation']);
  if (state === 'sustained-burst') return Object.freeze(['protect-foreground-or-services', 'hold-unapproved-gpu-policy']);
  if (state === 'burst-observed') return Object.freeze(['observe-next-gpu-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU utilization-burst clock must return a number');
  return timestamp;
}

export function runGpuUtilizationBurstTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  burstThreshold = 90,
  burstSampleThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('GPU utilization-burst samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredThreshold = requirePercentThreshold('burstThreshold', burstThreshold);
  const requiredBurstSamples = requireCount('burstSampleThreshold', burstSampleThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredThreshold));
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const burstCount = evidence.filter((item) => item.state === 'burst').length;
  const normalCount = evidence.filter((item) => item.state === 'normal').length;
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    burstCount, requiredBurstSamples);
  return Object.freeze({
    protocolVersion: 1,
    turbo: GPU_UTILIZATION_BURST_TURBO_ID,
    turboVersion: GPU_UTILIZATION_BURST_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount,
    invalidCount,
    burstCount,
    normalCount,
    burstThreshold: requiredThreshold,
    burstSampleThreshold: requiredBurstSamples,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
