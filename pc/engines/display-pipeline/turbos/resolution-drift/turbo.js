/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Display resolution-drift turbo. It observes resolution movement and aspect
 * evidence without changing display settings or opening transport.
 */

export const DISPLAY_RESOLUTION_DRIFT_TURBO_ID = 'display-pipeline.resolution-drift';
export const DISPLAY_RESOLUTION_DRIFT_TURBO_VERSION = 1;
export const DISPLAY_RESOLUTION_DRIFT_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Display resolution-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Display resolution-drift requires a system-facts snapshot');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!DISPLAY_RESOLUTION_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported display resolution-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Display resolution-drift windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Display resolution-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Display resolution-drift ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Display resolution-drift clock must return a number');
  return timestamp;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  if (source.environment === 'headless') return Object.freeze({ state: 'no-display', key: null });
  if (source.environment !== 'interactive') return Object.freeze({ state: 'incomplete', key: null });
  if (source.capabilities?.displayObservation === false) {
    return Object.freeze({ state: 'no-observation', key: null });
  }
  const width = positiveInteger(source.resolutionWidth);
  const height = positiveInteger(source.resolutionHeight);
  if (width === null || height === null) return Object.freeze({ state: 'incomplete', key: null });
  return Object.freeze({ state: 'observed', key: `${width}x${height}`, width, height });
}

function movement(evidence) {
  let transitionCount = 0;
  let comparisonCount = 0;
  let previous = null;
  for (const current of evidence) {
    if (current.key === null) {
      previous = null;
      continue;
    }
    if (previous !== null) {
      comparisonCount += 1;
      if (current.key !== previous) transitionCount += 1;
    }
    previous = current.key;
  }
  return { transitionCount, comparisonCount };
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, transitionCount,
  changeThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-display')) return 'no-display';
  if (evidence.some((item) => item.state === 'no-observation')) return 'no-observation';
  if (incompleteCount > 0) return 'incomplete-resolution-evidence';
  if (transitionCount >= changeThreshold) return 'resolution-drift-sustained';
  if (transitionCount > 0) return 'resolution-drift-observed';
  return 'stable-resolution';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-resolution-samples']);
  if (state === 'no-display') return Object.freeze(['keep-display-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-resolution-observation']);
  if (state === 'incomplete-resolution-evidence') return Object.freeze(['request-complete-resolution-evidence']);
  if (state === 'resolution-drift-sustained') {
    return Object.freeze(['review-resolution-workload', 'hold-unapproved-display-policy']);
  }
  if (state === 'resolution-drift-observed') return Object.freeze(['observe-next-resolution-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runDisplayResolutionDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  changeThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Display resolution-drift samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredChanges = requireCount('changeThreshold', changeThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noDisplayCount = evidence.filter((item) => item.state === 'no-display').length;
  const noObservationCount = evidence.filter((item) => item.state === 'no-observation').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const trend = movement(evidence);
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount,
    trend.transitionCount, requiredChanges);
  const latest = evidence.at(-1) || Object.freeze({ key: null, width: null, height: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: DISPLAY_RESOLUTION_DRIFT_TURBO_ID,
    turboVersion: DISPLAY_RESOLUTION_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    changeThreshold: requiredChanges,
    observedCount,
    incompleteCount,
    noDisplayCount,
    noObservationCount,
    transitionCount: trend.transitionCount,
    comparisonCount: trend.comparisonCount,
    latestResolution: latest.key,
    latestWidth: latest.width ?? null,
    latestHeight: latest.height ?? null,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
