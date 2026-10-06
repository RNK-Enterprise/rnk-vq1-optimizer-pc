/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Frame cadence-stability turbo. It measures bounded frame-time movement
 * without changing display policy, FPS caps, files, or opening transport.
 */

export const FRAME_CADENCE_STABILITY_TURBO_ID = 'frame-pacing.cadence-stability';
export const FRAME_CADENCE_STABILITY_TURBO_VERSION = 1;
export const FRAME_CADENCE_STABILITY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Frame cadence-stability snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Frame cadence-stability requires a system-facts snapshot');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!FRAME_CADENCE_STABILITY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported frame cadence-stability trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Frame cadence-stability windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Frame cadence-stability minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Frame cadence-stability ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Frame cadence-stability deltaThreshold must be non-negative');
  }
  return value;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  if (source.environment === 'headless') return Object.freeze({ state: 'no-display', value: null });
  if (source.capabilities?.displayObservation === false) {
    return Object.freeze({ state: 'no-observation', value: null });
  }
  const value = positive(source.frameTimeMs);
  return value === null
    ? Object.freeze({ state: 'incomplete', value: null })
    : Object.freeze({ state: 'observed', value });
}

function movement(evidence, deltaThreshold) {
  let driftCount = 0;
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
      if (delta >= deltaThreshold) driftCount += 1;
    }
    previous = current.value;
  }
  return { driftCount, comparisonCount, maximumDelta };
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, observedCount,
  driftCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-display')) return 'no-display';
  if (evidence.some((item) => item.state === 'no-observation')) return 'no-observation';
  if (incompleteCount > 0) return 'incomplete-cadence-evidence';
  if (driftCount >= persistenceThreshold) return 'sustained-cadence-drift';
  if (driftCount > 0) return 'cadence-drift-observed';
  return 'stable-cadence';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cadence-samples']);
  if (state === 'no-display') return Object.freeze(['keep-display-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-cadence-observation']);
  if (state === 'incomplete-cadence-evidence') return Object.freeze(['request-complete-cadence-evidence']);
  if (state === 'sustained-cadence-drift') {
    return Object.freeze(['review-frame-cadence', 'hold-unapproved-display-policy']);
  }
  if (state === 'cadence-drift-observed') return Object.freeze(['observe-next-cadence-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Frame cadence-stability clock must return a number');
  return timestamp;
}

export function runFrameCadenceStabilityTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  deltaThreshold = 2,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Frame cadence-stability samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredDelta = requireThreshold(deltaThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noDisplayCount = evidence.filter((item) => item.state === 'no-display').length;
  const noObservationCount = evidence.filter((item) => item.state === 'no-observation').length;
  const observedCount = evidence.filter((item) => item.value !== null).length;
  const trend = movement(evidence, requiredDelta);
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, observedCount,
    trend.driftCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: FRAME_CADENCE_STABILITY_TURBO_ID,
    turboVersion: FRAME_CADENCE_STABILITY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    observedCount,
    incompleteCount,
    noDisplayCount,
    noObservationCount,
    driftCount: trend.driftCount,
    comparisonCount: trend.comparisonCount,
    maximumDelta: trend.maximumDelta,
    deltaThreshold: requiredDelta,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
