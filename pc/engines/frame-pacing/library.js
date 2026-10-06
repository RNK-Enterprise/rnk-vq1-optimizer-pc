/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Frame-pacing library. It classifies display timing evidence for review and
 * never sets caps, changes display policy, or modifies files.
 */

export const FRAME_PACING_LIBRARY_ID = 'frame-pacing-library';
export const FRAME_PACING_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

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
  if (!isRecord(facts)) throw new TypeError('Frame-pacing library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Frame-pacing library requires normalized system facts');
  }
  return facts;
}

function levelFor(variance, dropped) {
  if (variance === null && dropped === null) return 'unknown';
  if ((variance !== null && variance >= 12) || (dropped !== null && dropped >= 10)) return 'high';
  if ((variance !== null && variance >= 5) || (dropped !== null && dropped >= 5)) return 'elevated';
  return 'normal';
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

function observationEnabled(capabilities) {
  return !(isRecord(capabilities) && capabilities.displayObservation === false);
}

export function classifyFramePacing(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const fps = nonNegative(source.fps);
  const targetFps = positive(source.targetFps);
  const frameTime = nonNegative(source.frameTimeMs);
  const variance = nonNegative(source.frameTimeVarianceMs);
  const dropped = percent(source.droppedFramePercent);
  const targetGap = fps === null || targetFps === null ? null : targetFps - fps;
  const level = levelFor(variance, dropped);
  const observation = observationEnabled(source.capabilities);
  return Object.freeze({
    library: FRAME_PACING_LIBRARY_ID,
    libraryVersion: FRAME_PACING_LIBRARY_VERSION,
    environment,
    fps,
    targetFps,
    targetGap,
    frameTimeMs: frameTime,
    frameTimeVarianceMs: variance,
    droppedFramePercent: dropped,
    level,
    observationEnabled: observation,
    recommendations: recommendations(environment, observation, level)
  });
}

export function compareFramePacing(previous, current) {
  const before = classifyFramePacing(previous);
  const after = classifyFramePacing(current);
  const levelChanged = before.level !== after.level;
  const varianceChanged = before.frameTimeVarianceMs !== after.frameTimeVarianceMs;
  const droppedChanged = before.droppedFramePercent !== after.droppedFramePercent;
  return Object.freeze({
    changed: levelChanged || varianceChanged || droppedChanged,
    levelChanged,
    varianceChanged,
    droppedChanged,
    targetGapChanged: before.targetGap !== after.targetGap
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Frame-pacing library clock must return a number');
  return timestamp;
}

export function buildFramePacingEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Frame-pacing library trigger is required');
  }
  return Object.freeze({
    library: FRAME_PACING_LIBRARY_ID,
    libraryVersion: FRAME_PACING_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyFramePacing(facts)
  });
}

export function createFramePacingLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Frame-pacing library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: FRAME_PACING_LIBRARY_ID,
    version: FRAME_PACING_LIBRARY_VERSION,
    classify: classifyFramePacing,
    compare: compareFramePacing,
    envelope: (facts, envelopeOptions = {}) => buildFramePacingEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
