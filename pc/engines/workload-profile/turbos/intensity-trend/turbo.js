/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Workload-profile intensity-trend turbo. It observes declared workload
 * intensity and reports movement without changing scheduling or process state.
 */

export const WORKLOAD_INTENSITY_TREND_TURBO_ID = 'workload-profile.intensity-trend';
export const WORKLOAD_INTENSITY_TREND_TURBO_VERSION = 1;
export const WORKLOAD_INTENSITY_TREND_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function intensityOf(value) { return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Workload-profile intensity-trend snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Workload-profile intensity-trend requires a system-facts snapshot');
  if (!isRecord(snapshot.workload)) throw new TypeError('Workload-profile intensity-trend snapshot requires a workload object');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const intensity = intensityOf(source.workload.intensity);
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', intensity, observed: intensity !== null });
}
function requireTrigger(trigger) {
  if (!WORKLOAD_INTENSITY_TREND_TRIGGERS.includes(trigger)) throw new Error(`Unsupported workload-profile intensity-trend trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Workload-profile intensity-trend windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Workload-profile intensity-trend minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Workload-profile intensity-trend persistenceThreshold must fit inside the window');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workload-profile intensity-trend clock must return a number'); return timestamp; }
function stateFor(sampleCount, minimumSamples, observedCount, unknownCount, risingCount, fallingCount, finalIntensity, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'intensity-unknown';
  if (unknownCount > 0) return 'observation-required';
  if (risingCount >= persistenceThreshold) return 'intensity-rise-sustained';
  if (fallingCount >= persistenceThreshold) return 'intensity-fall-sustained';
  if (risingCount > 0) return 'intensity-rise-observed';
  if (fallingCount > 0) return 'intensity-fall-observed';
  if (finalIntensity !== null && finalIntensity >= 80) return 'high-intensity';
  if (finalIntensity !== null && finalIntensity <= 20) return 'low-intensity';
  return 'stable-intensity';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-workload-intensity']);
  if (state === 'intensity-unknown') return Object.freeze(['request-workload-intensity-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-workload-intensity']);
  if (state === 'intensity-rise-sustained') return Object.freeze(['review-sustained-workload-intensity-rise']);
  if (state === 'intensity-fall-sustained') return Object.freeze(['review-sustained-workload-intensity-fall']);
  if (state === 'intensity-rise-observed') return Object.freeze(['observe-workload-intensity-rise']);
  if (state === 'intensity-fall-observed') return Object.freeze(['observe-workload-intensity-fall']);
  if (state === 'high-intensity') return Object.freeze(['review-high-workload-intensity']);
  if (state === 'low-intensity') return Object.freeze(['preserve-low-workload-intensity']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runWorkloadIntensityTrendTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Workload-profile intensity-trend samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf);
  const changes = evidence.slice(1).map((current, index) => {
    const previous = evidence[index]; const delta = previous.intensity === null || current.intensity === null ? null : current.intensity - previous.intensity;
    return Object.freeze({ rising: delta !== null && delta > 0, falling: delta !== null && delta < 0, changed: delta !== null && delta !== 0 });
  });
  const observedCount = evidence.filter((item) => item.observed).length; const unknownCount = evidence.length - observedCount;
  const risingCount = changes.filter((item) => item.rising).length; const fallingCount = changes.filter((item) => item.falling).length;
  const latest = evidence.length === 0 ? null : evidence[evidence.length - 1];
  const state = stateFor(selected.length, requiredSamples, observedCount, unknownCount, risingCount, fallingCount, latest ? latest.intensity : null, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: WORKLOAD_INTENSITY_TREND_TURBO_ID,
    turboVersion: WORKLOAD_INTENSITY_TREND_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length, minimumSamples: requiredSamples, persistenceThreshold: requiredPersistence,
    observedCount, unknownCount, comparisonCount: changes.length, changedCount: changes.filter((item) => item.changed).length,
    risingCount, fallingCount, finalIntensity: latest ? latest.intensity : null, finalEnvironment: latest ? latest.environment : 'unknown',
    state, confidence: confidence(selected.length, observedCount, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
