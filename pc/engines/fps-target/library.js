/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * FPS-target library. It derives a review candidate from user, display, or
 * observed evidence without applying a cap or changing display state.
 */

export const FPS_TARGET_LIBRARY_ID = 'fps-target-library';
export const FPS_TARGET_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('FPS-target library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('FPS-target library requires normalized system facts');
  }
  return facts;
}

function targetFor(refreshRate, observedFps, userTarget) {
  if (userTarget !== null) return refreshRate === null ? userTarget : Math.min(userTarget, refreshRate);
  if (refreshRate !== null) return refreshRate;
  return observedFps;
}

function targetSource(refreshRate, observedFps, userTarget) {
  if (userTarget !== null) return 'user';
  if (refreshRate !== null) return 'display';
  if (observedFps !== null) return 'observation';
  return 'unavailable';
}

function recommendations(environment, observation, target, observedFps, userTarget) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (environment === 'headless') return Object.freeze(['keep-fps-controls-disabled']);
  if (observation === false) return Object.freeze(['keep-fps-observation-disabled']);
  if (target === null) return Object.freeze(['request-refresh-or-fps-observation']);
  if (userTarget !== null) return Object.freeze(['preserve-user-fps-target']);
  if (observedFps === null) return Object.freeze(['observe-before-applying-target']);
  if (observedFps < target) return Object.freeze(['hold-target-below-observed-capability']);
  return Object.freeze(['no-change']);
}

function observationEnabled(capabilities) {
  return !(isRecord(capabilities) && capabilities.displayObservation === false);
}

export function classifyFpsTarget(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const refreshRate = positive(source.refreshRateHz);
  const observedFps = positive(source.fps);
  const userTarget = positive(source.userFpsTarget);
  const target = targetFor(refreshRate, observedFps, userTarget);
  const sourceType = targetSource(refreshRate, observedFps, userTarget);
  const observation = observationEnabled(source.capabilities);
  return Object.freeze({
    library: FPS_TARGET_LIBRARY_ID,
    libraryVersion: FPS_TARGET_LIBRARY_VERSION,
    environment,
    refreshRateHz: refreshRate,
    observedFps,
    userFpsTarget: userTarget,
    candidateFpsTarget: target,
    targetSource: sourceType,
    targetGap: target === null || observedFps === null ? null : target - observedFps,
    observationEnabled: observation,
    recommendations: recommendations(environment, observation, target, observedFps, userTarget)
  });
}

export function compareFpsTarget(previous, current) {
  const before = classifyFpsTarget(previous);
  const after = classifyFpsTarget(current);
  const targetChanged = before.candidateFpsTarget !== after.candidateFpsTarget;
  const sourceChanged = before.targetSource !== after.targetSource;
  const observedChanged = before.observedFps !== after.observedFps;
  return Object.freeze({
    changed: targetChanged || sourceChanged || observedChanged,
    targetChanged,
    sourceChanged,
    observedChanged,
    targetGapChanged: before.targetGap !== after.targetGap
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('FPS-target library clock must return a number');
  return timestamp;
}

export function buildFpsTargetEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('FPS-target library trigger is required');
  }
  return Object.freeze({
    library: FPS_TARGET_LIBRARY_ID,
    libraryVersion: FPS_TARGET_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyFpsTarget(facts)
  });
}

export function createFpsTargetLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('FPS-target library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: FPS_TARGET_LIBRARY_ID,
    version: FPS_TARGET_LIBRARY_VERSION,
    classify: classifyFpsTarget,
    compare: compareFpsTarget,
    envelope: (facts, envelopeOptions = {}) => buildFpsTargetEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
