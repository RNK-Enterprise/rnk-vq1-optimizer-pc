/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * FPS refresh-headroom turbo. It measures unused display budget and detects
 * persistent collapse without applying a cap or opening transport.
 */

export const FPS_REFRESH_HEADROOM_TURBO_ID = 'fps-target.refresh-headroom';
export const FPS_REFRESH_HEADROOM_TURBO_VERSION = 1;
export const FPS_REFRESH_HEADROOM_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('FPS refresh-headroom snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('FPS refresh-headroom requires a system-facts snapshot');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!FPS_REFRESH_HEADROOM_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported FPS refresh-headroom trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('FPS refresh-headroom windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('FPS refresh-headroom minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`FPS refresh-headroom ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('FPS refresh-headroom minimumHeadroom must be non-negative');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('FPS refresh-headroom clock must return a number');
  return timestamp;
}

function evidenceOf(snapshot, minimumHeadroom) {
  const source = requireSnapshot(snapshot);
  if (source.environment === 'headless') {
    return Object.freeze({ state: 'no-display', value: null });
  }
  if (source.environment !== 'interactive') {
    return Object.freeze({ state: 'incomplete', value: null });
  }
  if (source.capabilities?.displayObservation === false) {
    return Object.freeze({ state: 'no-observation', value: null });
  }
  const refreshRate = positive(source.refreshRateHz);
  const observedFps = positive(source.fps);
  if (refreshRate === null || observedFps === null) {
    return Object.freeze({ state: 'incomplete', value: null });
  }
  const headroom = Math.max(0, refreshRate - observedFps);
  return Object.freeze({ state: headroom < minimumHeadroom ? 'tight' : 'available', value: headroom });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, tightCount,
  persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-display')) return 'no-display';
  if (evidence.some((item) => item.state === 'no-observation')) return 'no-observation';
  if (incompleteCount > 0) return 'incomplete-headroom-evidence';
  if (tightCount >= persistenceThreshold) return 'headroom-collapse-sustained';
  if (tightCount > 0) return 'headroom-collapse-observed';
  return 'headroom-available';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-refresh-headroom-samples']);
  if (state === 'no-display') return Object.freeze(['keep-fps-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-refresh-headroom-observation']);
  if (state === 'incomplete-headroom-evidence') return Object.freeze(['request-refresh-and-fps-evidence']);
  if (state === 'headroom-collapse-sustained') {
    return Object.freeze(['review-refresh-headroom', 'hold-unapproved-fps-policy']);
  }
  if (state === 'headroom-collapse-observed') return Object.freeze(['observe-next-headroom-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runFpsRefreshHeadroomTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  minimumHeadroom = 3,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('FPS refresh-headroom samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredHeadroom = requireThreshold(minimumHeadroom);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredHeadroom));
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noDisplayCount = evidence.filter((item) => item.state === 'no-display').length;
  const noObservationCount = evidence.filter((item) => item.state === 'no-observation').length;
  const observedCount = evidence.filter((item) => item.value !== null).length;
  const tightCount = evidence.filter((item) => item.state === 'tight').length;
  const values = evidence.map((item) => item.value).filter((value) => value !== null);
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, tightCount,
    requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: FPS_REFRESH_HEADROOM_TURBO_ID,
    turboVersion: FPS_REFRESH_HEADROOM_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    minimumHeadroom: requiredHeadroom,
    observedCount,
    incompleteCount,
    noDisplayCount,
    noObservationCount,
    tightCount,
    minimumObservedHeadroom: values.length === 0 ? null : Math.min(...values),
    maximumObservedHeadroom: values.length === 0 ? null : Math.max(...values),
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
