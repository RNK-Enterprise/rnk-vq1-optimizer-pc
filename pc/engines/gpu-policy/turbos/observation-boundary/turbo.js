/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * GPU observation-boundary turbo. It measures bounded observation capability
 * stability without enabling sensors, changing policy, or opening transport.
 */

export const GPU_OBSERVATION_BOUNDARY_TURBO_ID = 'gpu-policy.observation-boundary';
export const GPU_OBSERVATION_BOUNDARY_TURBO_VERSION = 1;
export const GPU_OBSERVATION_BOUNDARY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('GPU observation-boundary snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('GPU observation-boundary requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.gpus)) {
    throw new TypeError('GPU observation-boundary snapshot requires a GPU list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!GPU_OBSERVATION_BOUNDARY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU observation-boundary trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('GPU observation-boundary windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('GPU observation-boundary minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`GPU observation-boundary ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const records = source.gpus.filter(isRecord);
  if (records.length === 0) return Object.freeze({ state: 'no-gpu', enabled: null });
  const capabilities = isRecord(source.capabilities) ? source.capabilities : null;
  if (!capabilities || typeof capabilities.gpuObservation !== 'boolean') {
    return Object.freeze({ state: 'unknown', enabled: null });
  }
  return Object.freeze({
    state: capabilities.gpuObservation ? 'enabled' : 'disabled',
    enabled: capabilities.gpuObservation
  });
}

function observed(evidence) {
  return evidence.filter((item) => item.state === 'enabled' || item.state === 'disabled');
}

function transitionCount(evidence) {
  let transitions = 0;
  for (let index = 1; index < evidence.length; index += 1) {
    const previous = evidence[index - 1].enabled;
    const current = evidence[index].enabled;
    if (previous !== null && current !== null && previous !== current) transitions += 1;
  }
  return transitions;
}

function stateFor(sampleCount, minimumSamples, evidence, observedEvidence, transitions,
  persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'unknown')) return 'observation-unknown';
  if (evidence.every((item) => item.state === 'no-gpu')) return 'no-gpu';
  if (evidence.some((item) => item.state === 'no-gpu')) return 'observation-boundary-drift';
  if (transitions >= persistenceThreshold) return 'sustained-observation-boundary-drift';
  if (transitions > 0) return 'observation-boundary-observed';
  if (observedEvidence.every((item) => item.state === 'disabled')) return 'observation-disabled-persistent';
  return 'observation-enabled-stable';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-gpu-observation-samples']);
  if (state === 'observation-unknown') return Object.freeze(['request-gpu-observation-capability-evidence']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-controls-disabled']);
  if (state === 'observation-boundary-drift') {
    return Object.freeze(['review-gpu-observation-boundary', 'hold-unapproved-gpu-policy']);
  }
  if (state === 'sustained-observation-boundary-drift') {
    return Object.freeze(['review-gpu-observation-stability', 'hold-unapproved-gpu-policy']);
  }
  if (state === 'observation-boundary-observed') {
    return Object.freeze(['observe-next-gpu-observation-sample']);
  }
  if (state === 'observation-disabled-persistent') {
    return Object.freeze(['keep-gpu-observation-disabled']);
  }
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
    throw new TypeError('GPU observation-boundary clock must return a number');
  }
  return timestamp;
}

export function runGpuObservationBoundaryTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('GPU observation-boundary samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usable = observed(evidence);
  const transitions = transitionCount(evidence);
  const enabledCount = evidence.filter((item) => item.state === 'enabled').length;
  const disabledCount = evidence.filter((item) => item.state === 'disabled').length;
  const unknownCount = evidence.filter((item) => item.state === 'unknown').length;
  const noGpuCount = evidence.filter((item) => item.state === 'no-gpu').length;
  const state = stateFor(selected.length, requiredSamples, evidence, usable, transitions,
    requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: GPU_OBSERVATION_BOUNDARY_TURBO_ID,
    turboVersion: GPU_OBSERVATION_BOUNDARY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    observedCount: usable.length,
    enabledCount,
    disabledCount,
    unknownCount,
    noGpuCount,
    transitionCount: transitions,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
