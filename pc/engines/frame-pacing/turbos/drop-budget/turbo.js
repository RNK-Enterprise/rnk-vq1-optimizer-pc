/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Frame drop-budget turbo. It measures bounded dropped-frame pressure without
 * changing display policy, FPS caps, files, or opening transport.
 */

export const FRAME_DROP_BUDGET_TURBO_ID = 'frame-pacing.drop-budget';
export const FRAME_DROP_BUDGET_TURBO_VERSION = 1;
export const FRAME_DROP_BUDGET_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Frame drop-budget snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Frame drop-budget requires a system-facts snapshot');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!FRAME_DROP_BUDGET_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported frame drop-budget trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Frame drop-budget windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Frame drop-budget minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Frame drop-budget ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`Frame drop-budget ${name} must be between 0 and 100`);
  }
  return value;
}

function evidenceOf(snapshot, criticalThreshold, elevatedThreshold) {
  const source = requireSnapshot(snapshot);
  if (source.environment === 'headless') return Object.freeze({ state: 'no-display', value: null });
  if (source.capabilities?.displayObservation === false) {
    return Object.freeze({ state: 'no-observation', value: null });
  }
  const value = percent(source.droppedFramePercent);
  if (value === null) return Object.freeze({ state: 'incomplete', value: null });
  const state = value >= criticalThreshold ? 'critical' : value >= elevatedThreshold ? 'elevated' : 'normal';
  return Object.freeze({ state, value });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, criticalCount,
  elevatedCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-display')) return 'no-display';
  if (evidence.some((item) => item.state === 'no-observation')) return 'no-observation';
  if (incompleteCount > 0) return 'incomplete-drop-evidence';
  if (criticalCount >= persistenceThreshold) return 'critical-drop-sustained';
  if (criticalCount > 0) return 'critical-drop-observed';
  if (elevatedCount >= persistenceThreshold) return 'elevated-drop-sustained';
  if (elevatedCount > 0) return 'elevated-drop-observed';
  return 'normal-drop-budget';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-dropped-frame-samples']);
  if (state === 'no-display') return Object.freeze(['keep-display-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['request-dropped-frame-observation']);
  if (state === 'incomplete-drop-evidence') return Object.freeze(['request-complete-drop-evidence']);
  if (state === 'critical-drop-sustained') {
    return Object.freeze(['protect-foreground', 'hold-unapproved-display-policy']);
  }
  if (state === 'critical-drop-observed') return Object.freeze(['observe-next-drop-sample']);
  if (state === 'elevated-drop-sustained') return Object.freeze(['review-frame-drop-budget']);
  if (state === 'elevated-drop-observed') return Object.freeze(['observe-next-drop-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Frame drop-budget clock must return a number');
  return timestamp;
}

export function runFrameDropBudgetTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  criticalThreshold = 10,
  elevatedThreshold = 5,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Frame drop-budget samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const critical = requireThreshold('criticalThreshold', criticalThreshold);
  const elevated = requireThreshold('elevatedThreshold', elevatedThreshold);
  if (elevated >= critical) throw new RangeError('Frame drop-budget elevatedThreshold must be below criticalThreshold');
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
  const maximumDroppedPercent = observedCount === 0 ? null
    : Math.max(...evidence.map((item) => item.value).filter((value) => value !== null));
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, criticalCount,
    elevatedCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: FRAME_DROP_BUDGET_TURBO_ID,
    turboVersion: FRAME_DROP_BUDGET_TURBO_VERSION,
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
    maximumDroppedPercent,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
