/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Frame target-gap turbo. It measures bounded FPS shortfall against an
 * explicit target without changing caps, display policy, files, or transport.
 */

export const FRAME_TARGET_GAP_TURBO_ID = 'frame-pacing.target-gap';
export const FRAME_TARGET_GAP_TURBO_VERSION = 1;
export const FRAME_TARGET_GAP_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

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

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Frame target-gap snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Frame target-gap requires a system-facts snapshot');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!FRAME_TARGET_GAP_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported frame target-gap trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Frame target-gap windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Frame target-gap minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Frame target-gap ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(name, value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Frame target-gap ${name} must be non-negative`);
  }
  return value;
}

function evidenceOf(snapshot, criticalThreshold, elevatedThreshold) {
  const source = requireSnapshot(snapshot);
  if (source.environment === 'headless') return Object.freeze({ state: 'no-display', value: null });
  if (source.capabilities?.displayObservation === false) {
    return Object.freeze({ state: 'no-observation', value: null });
  }
  const fps = nonNegative(source.fps);
  const target = positive(source.targetFps);
  if (fps === null || target === null) return Object.freeze({ state: 'incomplete', value: null });
  const value = Math.max(0, target - fps);
  const state = value >= criticalThreshold ? 'critical' : value >= elevatedThreshold ? 'elevated' : 'healthy';
  return Object.freeze({ state, value });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, criticalCount,
  elevatedCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-display')) return 'no-display';
  if (evidence.some((item) => item.state === 'no-observation')) return 'no-observation';
  if (incompleteCount > 0) return 'incomplete-target-evidence';
  if (criticalCount >= persistenceThreshold) return 'critical-gap-sustained';
  if (criticalCount > 0) return 'critical-gap-observed';
  if (elevatedCount >= persistenceThreshold) return 'elevated-gap-sustained';
  if (elevatedCount > 0) return 'elevated-gap-observed';
  return 'healthy-target-gap';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-target-gap-samples']);
  if (state === 'no-display') return Object.freeze(['keep-display-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-target-gap-observation']);
  if (state === 'incomplete-target-evidence') return Object.freeze(['request-explicit-fps-target']);
  if (state === 'critical-gap-sustained') {
    return Object.freeze(['review-foreground-workload', 'hold-unapproved-display-policy']);
  }
  if (state === 'critical-gap-observed') return Object.freeze(['observe-next-target-gap-sample']);
  if (state === 'elevated-gap-sustained') return Object.freeze(['review-fps-target-gap']);
  if (state === 'elevated-gap-observed') return Object.freeze(['observe-next-target-gap-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Frame target-gap clock must return a number');
  return timestamp;
}

export function runFrameTargetGapTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  criticalThreshold = 10,
  elevatedThreshold = 3,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Frame target-gap samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const critical = requireThreshold('criticalThreshold', criticalThreshold);
  const elevated = requireThreshold('elevatedThreshold', elevatedThreshold);
  if (elevated >= critical) throw new RangeError('Frame target-gap elevatedThreshold must be below criticalThreshold');
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, critical, elevated));
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noDisplayCount = evidence.filter((item) => item.state === 'no-display').length;
  const noObservationCount = evidence.filter((item) => item.state === 'no-observation').length;
  const observedCount = evidence.filter((item) => item.value !== null).length;
  const criticalCount = evidence.filter((item) => item.state === 'critical').length;
  const elevatedCount = evidence.filter((item) => item.state === 'elevated').length;
  const maximumGap = observedCount === 0 ? null
    : Math.max(...evidence.map((item) => item.value).filter((value) => value !== null));
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, criticalCount,
    elevatedCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: FRAME_TARGET_GAP_TURBO_ID,
    turboVersion: FRAME_TARGET_GAP_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    criticalThreshold: critical,
    elevatedThreshold: elevated,
    observedCount,
    incompleteCount,
    noDisplayCount,
    noObservationCount,
    criticalCount,
    elevatedCount,
    maximumGap,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
