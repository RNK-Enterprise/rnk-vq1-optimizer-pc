/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * FPS target-source drift turbo. It observes changes between user, display,
 * and measured FPS target provenance without applying a cap or opening transport.
 */

export const FPS_TARGET_SOURCE_DRIFT_TURBO_ID = 'fps-target.target-source-drift';
export const FPS_TARGET_SOURCE_DRIFT_TURBO_VERSION = 1;
export const FPS_TARGET_SOURCE_DRIFT_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('FPS target-source snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('FPS target-source drift requires a system-facts snapshot');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!FPS_TARGET_SOURCE_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported FPS target-source drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('FPS target-source drift windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('FPS target-source drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`FPS target-source drift ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('FPS target-source drift clock must return a number');
  return timestamp;
}

function environmentOf(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) ? snapshot.environment : 'unknown';
}

function targetFor(refreshRate, observedFps, userTarget) {
  if (userTarget !== null) return refreshRate === null ? userTarget : Math.min(userTarget, refreshRate);
  if (refreshRate !== null) return refreshRate;
  return observedFps;
}

function sourceFor(refreshRate, observedFps, userTarget) {
  if (userTarget !== null) return 'user';
  if (refreshRate !== null) return 'display';
  if (observedFps !== null) return 'observation';
  return 'unavailable';
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const environment = environmentOf(source);
  if (environment === 'headless') {
    return Object.freeze({ state: 'no-display', source: 'unavailable', target: null });
  }
  if (environment === 'unknown') {
    return Object.freeze({ state: 'incomplete', source: 'unavailable', target: null });
  }
  if (source.capabilities?.displayObservation === false) {
    return Object.freeze({ state: 'no-observation', source: 'unavailable', target: null });
  }
  const refreshRate = positive(source.refreshRateHz);
  const observedFps = positive(source.fps);
  const userTarget = positive(source.userFpsTarget);
  const target = targetFor(refreshRate, observedFps, userTarget);
  const targetSource = sourceFor(refreshRate, observedFps, userTarget);
  if (target === null) return Object.freeze({ state: 'incomplete', source: 'unavailable', target: null });
  return Object.freeze({ state: 'observed', source: targetSource, target });
}

function movement(evidence) {
  let transitionCount = 0;
  let comparisonCount = 0;
  let previous = null;
  for (const current of evidence) {
    if (current.state !== 'observed') {
      previous = null;
      continue;
    }
    if (previous !== null) {
      comparisonCount += 1;
      if (current.source !== previous) transitionCount += 1;
    }
    previous = current.source;
  }
  return { transitionCount, comparisonCount };
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, transitionCount,
  changeThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-display')) return 'no-display';
  if (evidence.some((item) => item.state === 'no-observation')) return 'no-observation';
  if (incompleteCount > 0) return 'incomplete-target-evidence';
  if (transitionCount >= changeThreshold) return 'source-drift-sustained';
  if (transitionCount > 0) return 'source-drift-observed';
  return 'stable-target-source';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-target-source-samples']);
  if (state === 'no-display') return Object.freeze(['keep-fps-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-fps-target-observation']);
  if (state === 'incomplete-target-evidence') return Object.freeze(['request-target-source-evidence']);
  if (state === 'source-drift-sustained') {
    return Object.freeze(['review-target-provenance', 'hold-unapproved-fps-policy']);
  }
  if (state === 'source-drift-observed') return Object.freeze(['observe-next-target-source']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runFpsTargetSourceDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  changeThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('FPS target-source drift samples must be an array');
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
  const userCount = evidence.filter((item) => item.source === 'user').length;
  const displayCount = evidence.filter((item) => item.source === 'display').length;
  const observationCount = evidence.filter((item) => item.source === 'observation').length;
  const trend = movement(evidence);
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount,
    trend.transitionCount, requiredChanges);
  const latest = evidence.at(-1) || Object.freeze({ source: 'unavailable', target: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: FPS_TARGET_SOURCE_DRIFT_TURBO_ID,
    turboVersion: FPS_TARGET_SOURCE_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    changeThreshold: requiredChanges,
    observedCount,
    incompleteCount,
    noDisplayCount,
    noObservationCount,
    userCount,
    displayCount,
    observationCount,
    transitionCount: trend.transitionCount,
    comparisonCount: trend.comparisonCount,
    latestSource: latest.source,
    latestTarget: latest.target,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
