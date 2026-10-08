/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * FPS user-target guard turbo. It audits explicit user targets against
 * documented refresh evidence without rewriting the target or opening transport.
 */

export const FPS_USER_TARGET_GUARD_TURBO_ID = 'fps-target.user-target-guard';
export const FPS_USER_TARGET_GUARD_TURBO_VERSION = 1;
export const FPS_USER_TARGET_GUARD_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('FPS user-target snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('FPS user-target guard requires a system-facts snapshot');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!FPS_USER_TARGET_GUARD_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported FPS user-target guard trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('FPS user-target guard windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('FPS user-target guard minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`FPS user-target guard ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('FPS user-target guard clock must return a number');
  return timestamp;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  if (source.environment === 'headless') return Object.freeze({ state: 'no-display', target: null });
  if (source.environment !== 'interactive') {
    return Object.freeze({ state: 'incomplete', target: null });
  }
  if (source.capabilities?.displayObservation === false) {
    return Object.freeze({ state: 'no-observation', target: null });
  }
  const target = positive(source.userFpsTarget);
  const refreshRate = positive(source.refreshRateHz);
  if (target === null) return Object.freeze({ state: 'missing-target', target: null });
  if (refreshRate === null) return Object.freeze({ state: 'without-display', target });
  if (target > refreshRate) return Object.freeze({ state: 'over-refresh', target, refreshRate });
  return Object.freeze({ state: 'preserved', target, refreshRate });
}

function stateFor(sampleCount, minimumSamples, evidence, missingCount, overRefreshCount,
  withoutDisplayCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-display')) return 'no-display';
  if (evidence.some((item) => item.state === 'no-observation')) return 'no-observation';
  if (evidence.some((item) => item.state === 'incomplete')) return 'incomplete-user-target-evidence';
  if (missingCount === sampleCount) return 'no-user-target';
  if (missingCount > 0) return 'incomplete-user-target-evidence';
  if (withoutDisplayCount > 0) return 'target-without-display';
  if (overRefreshCount >= persistenceThreshold) return 'target-over-refresh-sustained';
  if (overRefreshCount > 0) return 'target-over-refresh-observed';
  return 'user-target-preserved';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-user-target-samples']);
  if (state === 'no-display') return Object.freeze(['keep-fps-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['keep-user-target-observation-disabled']);
  if (state === 'incomplete-user-target-evidence') return Object.freeze(['request-complete-user-target-evidence']);
  if (state === 'no-user-target') return Object.freeze(['preserve-no-user-target-state']);
  if (state === 'target-without-display') return Object.freeze(['observe-display-before-comparing-target']);
  if (state === 'target-over-refresh-sustained') {
    return Object.freeze(['review-user-target-against-refresh', 'preserve-user-intent']);
  }
  if (state === 'target-over-refresh-observed') return Object.freeze(['observe-next-user-target']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runFpsUserTargetGuardTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('FPS user-target guard samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const missingCount = evidence.filter((item) => item.state === 'missing-target').length;
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noDisplayCount = evidence.filter((item) => item.state === 'no-display').length;
  const noObservationCount = evidence.filter((item) => item.state === 'no-observation').length;
  const observedCount = evidence.filter((item) => item.target !== null).length;
  const withoutDisplayCount = evidence.filter((item) => item.state === 'without-display').length;
  const overRefreshCount = evidence.filter((item) => item.state === 'over-refresh').length;
  const targets = evidence.map((item) => item.target).filter((value) => value !== null);
  const state = stateFor(selected.length, requiredSamples, evidence, missingCount, overRefreshCount,
    withoutDisplayCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: FPS_USER_TARGET_GUARD_TURBO_ID,
    turboVersion: FPS_USER_TARGET_GUARD_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    observedCount,
    missingCount,
    incompleteCount,
    noDisplayCount,
    noObservationCount,
    withoutDisplayCount,
    overRefreshCount,
    minimumUserTarget: targets.length === 0 ? null : Math.min(...targets),
    maximumUserTarget: targets.length === 0 ? null : Math.max(...targets),
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
