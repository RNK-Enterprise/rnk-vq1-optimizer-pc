/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Display refresh-drift turbo. It observes refresh-rate movement without
 * changing refresh policy, display settings, or opening transport.
 */

export const DISPLAY_REFRESH_DRIFT_TURBO_ID = 'display-pipeline.refresh-drift';
export const DISPLAY_REFRESH_DRIFT_TURBO_VERSION = 1;
export const DISPLAY_REFRESH_DRIFT_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('Display refresh-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Display refresh-drift requires a system-facts snapshot');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!DISPLAY_REFRESH_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported display refresh-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Display refresh-drift windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Display refresh-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Display refresh-drift ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Display refresh-drift deltaThreshold must be non-negative');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Display refresh-drift clock must return a number');
  return timestamp;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  if (source.environment === 'headless') return Object.freeze({ state: 'no-display', value: null });
  if (source.environment !== 'interactive') return Object.freeze({ state: 'incomplete', value: null });
  if (source.capabilities?.displayObservation === false) {
    return Object.freeze({ state: 'no-observation', value: null });
  }
  const value = positive(source.refreshRateHz);
  return value === null
    ? Object.freeze({ state: 'incomplete', value: null })
    : Object.freeze({ state: 'observed', value });
}

function movement(evidence, deltaThreshold) {
  let deltaCount = 0;
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
      if (delta >= deltaThreshold) deltaCount += 1;
    }
    previous = current.value;
  }
  return { deltaCount, comparisonCount, maximumDelta };
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, deltaCount,
  changeThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-display')) return 'no-display';
  if (evidence.some((item) => item.state === 'no-observation')) return 'no-observation';
  if (incompleteCount > 0) return 'incomplete-refresh-evidence';
  if (deltaCount >= changeThreshold) return 'refresh-drift-sustained';
  if (deltaCount > 0) return 'refresh-drift-observed';
  return 'stable-refresh';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-refresh-samples']);
  if (state === 'no-display') return Object.freeze(['keep-display-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-refresh-observation']);
  if (state === 'incomplete-refresh-evidence') return Object.freeze(['request-complete-refresh-evidence']);
  if (state === 'refresh-drift-sustained') {
    return Object.freeze(['review-refresh-stability', 'hold-unapproved-display-policy']);
  }
  if (state === 'refresh-drift-observed') return Object.freeze(['observe-next-refresh-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runDisplayRefreshDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  deltaThreshold = 5,
  changeThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Display refresh-drift samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredDelta = requireThreshold(deltaThreshold);
  const requiredChanges = requireCount('changeThreshold', changeThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noDisplayCount = evidence.filter((item) => item.state === 'no-display').length;
  const noObservationCount = evidence.filter((item) => item.state === 'no-observation').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const trend = movement(evidence, requiredDelta);
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount,
    trend.deltaCount, requiredChanges);
  const latest = evidence.at(-1) || Object.freeze({ value: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: DISPLAY_REFRESH_DRIFT_TURBO_ID,
    turboVersion: DISPLAY_REFRESH_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    changeThreshold: requiredChanges,
    deltaThreshold: requiredDelta,
    observedCount,
    incompleteCount,
    noDisplayCount,
    noObservationCount,
    deltaCount: trend.deltaCount,
    comparisonCount: trend.comparisonCount,
    maximumDelta: trend.maximumDelta,
    latestRefreshRateHz: latest.value,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
