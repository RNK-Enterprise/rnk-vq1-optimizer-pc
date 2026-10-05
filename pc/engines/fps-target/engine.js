/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * FPS-target engine. It proposes a bounded target from user-owned or
 * observed values without applying a cap or changing display state.
 */

export const FPS_TARGET_ENGINE_ID = 'fps-target';
export const FPS_TARGET_ENGINE_VERSION = 1;
export const FPS_TARGET_TRIGGERS = Object.freeze([
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

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('FPS-target facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('FPS-target requires system-facts facts');
  return facts;
}

function requireTrigger(trigger) {
  if (!FPS_TARGET_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported FPS-target trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('FPS-target clock must return a number');
  return timestamp;
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

function operatingState(environment, observation, target, observedFps, userTarget) {
  if (environment === 'unknown') return 'profile-required';
  if (environment === 'headless') return 'no-display';
  if (observation === false) return 'observation-disabled';
  if (target === null) return 'target-required';
  if (userTarget !== null) return 'user-target';
  if (observedFps === null) return 'display-target';
  if (observedFps < target) return 'headroom-required';
  return 'observe';
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

function confidence(environment, refreshRate, observedFps, userTarget) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (refreshRate !== null) score += 0.3;
  if (observedFps !== null) score += 0.3;
  if (userTarget !== null) score += 0.2;
  return Math.round(score * 10000) / 10000;
}

export function runFpsTargetEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const refreshRate = positive(source.refreshRateHz);
  const observedFps = positive(source.fps);
  const userTarget = positive(source.userFpsTarget);
  const target = targetFor(refreshRate, observedFps, userTarget);
  const sourceType = targetSource(refreshRate, observedFps, userTarget);
  const observation = source.capabilities?.displayObservation !== false;
  return Object.freeze({
    protocolVersion: 1,
    engine: FPS_TARGET_ENGINE_ID,
    engineVersion: FPS_TARGET_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    refreshRateHz: refreshRate,
    observedFps,
    userFpsTarget: userTarget,
    candidateFpsTarget: target,
    targetSource: sourceType,
    targetGap: target === null || observedFps === null ? null : target - observedFps,
    observationEnabled: observation,
    state: operatingState(environment, observation, target, observedFps, userTarget),
    confidence: confidence(environment, refreshRate, observedFps, userTarget),
    recommendations: recommendations(environment, observation, target, observedFps, userTarget),
    actions: EMPTY_ARRAY
  });
}
