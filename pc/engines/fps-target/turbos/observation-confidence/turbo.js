/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * FPS observation-confidence turbo. It scores evidence completeness without
 * applying a target, changing display policy, or opening transport.
 */

export const FPS_OBSERVATION_CONFIDENCE_TURBO_ID = 'fps-target.observation-confidence';
export const FPS_OBSERVATION_CONFIDENCE_TURBO_VERSION = 1;
export const FPS_OBSERVATION_CONFIDENCE_TRIGGERS = Object.freeze([
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
  return Number.isFinite(value) && value > 0;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('FPS observation-confidence snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('FPS observation-confidence requires a system-facts snapshot');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!FPS_OBSERVATION_CONFIDENCE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported FPS observation-confidence trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('FPS observation-confidence windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('FPS observation-confidence minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`FPS observation-confidence ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError('FPS observation-confidence minimumConfidence must be above 0 and at most 1');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('FPS observation-confidence clock must return a number');
  return timestamp;
}

function evidenceOf(snapshot, minimumConfidence) {
  const source = requireSnapshot(snapshot);
  if (source.environment === 'headless') {
    return Object.freeze({ state: 'no-display', score: null });
  }
  if (source.environment !== 'interactive') {
    return Object.freeze({ state: 'incomplete', score: 0 });
  }
  if (source.capabilities?.displayObservation === false) {
    return Object.freeze({ state: 'no-observation', score: null });
  }
  const score = (positive(source.refreshRateHz) ? 0.4 : 0)
    + (positive(source.fps) ? 0.4 : 0)
    + (positive(source.userFpsTarget) ? 0.2 : 0);
  if (score === 0) return Object.freeze({ state: 'incomplete', score });
  if (score < minimumConfidence) return Object.freeze({ state: 'low', score });
  if (score < 1) return Object.freeze({ state: 'partial', score });
  return Object.freeze({ state: 'complete', score });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, lowCount,
  partialCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-display')) return 'no-display';
  if (evidence.some((item) => item.state === 'no-observation')) return 'no-observation';
  if (incompleteCount > 0) return 'incomplete-observation';
  if (lowCount >= persistenceThreshold) return 'low-confidence-sustained';
  if (lowCount > 0) return 'low-confidence-observed';
  if (partialCount > 0) return 'partial-observation';
  return 'high-confidence-observation';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-confidence-samples']);
  if (state === 'no-display') return Object.freeze(['keep-fps-controls-disabled']);
  if (state === 'no-observation') return Object.freeze(['keep-confidence-observation-disabled']);
  if (state === 'incomplete-observation') return Object.freeze(['request-refresh-and-fps-evidence']);
  if (state === 'low-confidence-sustained') {
    return Object.freeze(['hold-target-decision', 'request-complete-fps-evidence']);
  }
  if (state === 'low-confidence-observed') return Object.freeze(['observe-next-confidence-sample']);
  if (state === 'partial-observation') return Object.freeze(['complete-optional-fps-evidence']);
  return Object.freeze(['no-change']);
}

export function runFpsObservationConfidenceTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  minimumConfidence = 0.75,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('FPS observation-confidence samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredConfidence = requireThreshold(minimumConfidence);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredConfidence));
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noDisplayCount = evidence.filter((item) => item.state === 'no-display').length;
  const noObservationCount = evidence.filter((item) => item.state === 'no-observation').length;
  const completeCount = evidence.filter((item) => item.state === 'complete').length;
  const partialCount = evidence.filter((item) => item.state === 'partial').length;
  const lowCount = evidence.filter((item) => item.state === 'low').length;
  const scores = evidence.map((item) => item.score).filter((score) => score !== null);
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, lowCount,
    partialCount, requiredPersistence);
  const averageConfidence = scores.length === 0 ? null
    : Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10000) / 10000;
  return Object.freeze({
    protocolVersion: 1,
    turbo: FPS_OBSERVATION_CONFIDENCE_TURBO_ID,
    turboVersion: FPS_OBSERVATION_CONFIDENCE_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    minimumConfidence: requiredConfidence,
    completeCount,
    partialCount,
    lowCount,
    incompleteCount,
    noDisplayCount,
    noObservationCount,
    averageConfidence,
    state,
    confidence: scores.length === 0 ? 0 : averageConfidence,
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
