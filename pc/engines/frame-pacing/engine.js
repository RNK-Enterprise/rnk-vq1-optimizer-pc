/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Frame-pacing engine. It classifies bounded display timing observations
 * without changing FPS caps, display settings, files, or transport state.
 */

export const FRAME_PACING_ENGINE_ID = 'frame-pacing';
export const FRAME_PACING_ENGINE_VERSION = 1;
export const FRAME_PACING_TRIGGERS = Object.freeze([
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

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Frame-pacing facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Frame-pacing requires system-facts facts');
  return facts;
}

function requireTrigger(trigger) {
  if (!FRAME_PACING_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported frame-pacing trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Frame-pacing clock must return a number');
  return timestamp;
}

function levelFor(variance, dropped) {
  if (variance === null && dropped === null) return 'unknown';
  if ((variance !== null && variance >= 12) || (dropped !== null && dropped >= 10)) return 'high';
  if ((variance !== null && variance >= 5) || (dropped !== null && dropped >= 5)) return 'elevated';
  return 'normal';
}

function operatingState(environment, observation, level) {
  if (environment === 'unknown') return 'profile-required';
  if (environment === 'headless') return 'no-display';
  if (observation === false) return 'observation-disabled';
  if (level === 'unknown') return 'observation-required';
  if (level === 'high') return 'protect-foreground';
  if (level === 'elevated') return 'watch';
  return 'observe';
}

function recommendations(environment, observation, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (environment === 'headless') return Object.freeze(['keep-display-controls-disabled']);
  if (observation === false) return Object.freeze(['keep-frame-observation-disabled']);
  if (level === 'unknown') return Object.freeze(['request-frame-pacing-observation']);
  if (level === 'high') return Object.freeze(['protect-foreground', 'hold-unapproved-display-policy']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample', 'review-frame-jitter']);
  return Object.freeze(['no-change']);
}

function confidence(environment, frameTime, variance, dropped) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (frameTime !== null) score += 0.3;
  if (variance !== null) score += 0.25;
  if (dropped !== null) score += 0.25;
  return Math.round(score * 10000) / 10000;
}

export function runFramePacingEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const fps = nonNegative(source.fps);
  const targetFps = positive(source.targetFps);
  const frameTime = nonNegative(source.frameTimeMs);
  const variance = nonNegative(source.frameTimeVarianceMs);
  const dropped = percent(source.droppedFramePercent);
  const targetGap = fps === null || targetFps === null ? null : targetFps - fps;
  const level = levelFor(variance, dropped);
  const observation = source.capabilities?.displayObservation !== false;
  return Object.freeze({
    protocolVersion: 1,
    engine: FRAME_PACING_ENGINE_ID,
    engineVersion: FRAME_PACING_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    fps,
    targetFps,
    targetGap,
    frameTimeMs: frameTime,
    frameTimeVarianceMs: variance,
    droppedFramePercent: dropped,
    level,
    observationEnabled: observation,
    state: operatingState(environment, observation, level),
    confidence: confidence(environment, frameTime, variance, dropped),
    recommendations: recommendations(environment, observation, level),
    actions: EMPTY_ARRAY
  });
}
