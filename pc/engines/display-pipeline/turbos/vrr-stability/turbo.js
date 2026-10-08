/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Display VRR-stability turbo. It observes variable-refresh state movement
 * without enabling, disabling, or otherwise changing display policy.
 */

export const DISPLAY_VRR_STABILITY_TURBO_ID = 'display-pipeline.vrr-stability';
export const DISPLAY_VRR_STABILITY_TURBO_VERSION = 1;
export const DISPLAY_VRR_STABILITY_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('Display VRR-stability snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Display VRR-stability requires a system-facts snapshot');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!DISPLAY_VRR_STABILITY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported display VRR-stability trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Display VRR-stability windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Display VRR-stability minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Display VRR-stability ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Display VRR-stability clock must return a number');
  return timestamp;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  if (source.environment === 'headless') return Object.freeze({ state: 'no-display', value: null });
  if (source.environment !== 'interactive') return Object.freeze({ state: 'incomplete', value: null });
  if (source.capabilities?.displayObservation === false) {
    return Object.freeze({ state: 'no-observation', value: null });
  }
  if (typeof source.vrr !== 'boolean') return Object.freeze({ state: 'incomplete', value: null });
  return Object.freeze({ state: 'observed', value: source.vrr });
}

function movement(evidence) {
  let transitionCount = 0;
  let comparisonCount = 0;
  let previous = null;
  for (const current of evidence) {
    if (current.value === null) {
      previous = null;
      continue;
    }
    if (previous !== null) {
      comparisonCount += 1;
      if (current.value !== previous) transitionCount += 1;
    }
    previous = current.value;
  }
  return { transitionCount, comparisonCount };
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, transitionCount,
  changeThreshold, enabledCount) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-display')) return 'no-display';
  if (evidence.some((item) => item.state === 'no-observation')) return 'no-observation';
  if (incompleteCount > 0) return 'incomplete-vrr-evidence';
  if (transitionCount >= changeThreshold) return 'vrr-drift-sustained';
  if (transitionCount > 0) return 'vrr-drift-observed';
  return enabledCount === sampleCount ? 'vrr-stable-enabled' : 'vrr-stable-disabled';
}

function recommendations(state) {
  const recommendationsByState = {
    'insufficient-data': ['collect-more-vrr-samples'],
    'no-display': ['keep-display-controls-disabled'],
    'no-observation': ['request-vrr-observation'],
    'incomplete-vrr-evidence': ['request-complete-vrr-evidence'],
    'vrr-drift-sustained': ['review-vrr-stability', 'hold-unapproved-display-policy'],
    'vrr-drift-observed': ['observe-next-vrr-sample'],
    'vrr-stable-enabled': ['preserve-observed-vrr-state'],
    'vrr-stable-disabled': ['preserve-observed-fixed-refresh-state']
  };
  return Object.freeze(recommendationsByState[state]);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runDisplayVrrStabilityTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  changeThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Display VRR-stability samples must be an array');
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
  const enabledCount = evidence.filter((item) => item.value === true).length;
  const trend = movement(evidence);
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount,
    trend.transitionCount, requiredChanges, enabledCount);
  const latest = evidence.at(-1) || Object.freeze({ value: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: DISPLAY_VRR_STABILITY_TURBO_ID,
    turboVersion: DISPLAY_VRR_STABILITY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    changeThreshold: requiredChanges,
    observedCount,
    enabledCount,
    disabledCount: observedCount - enabledCount,
    incompleteCount,
    noDisplayCount,
    noObservationCount,
    transitionCount: trend.transitionCount,
    comparisonCount: trend.comparisonCount,
    latestVrr: latest.value,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
