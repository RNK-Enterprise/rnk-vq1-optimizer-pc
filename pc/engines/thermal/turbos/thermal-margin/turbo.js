/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Thermal-margin turbo. It tracks critical-temperature headroom over bounded
 * samples and never changes fans, governors, workloads, or power state.
 */
export const THERMAL_MARGIN_TURBO_ID = 'thermal.thermal-margin';
export const THERMAL_MARGIN_TURBO_VERSION = 1;
export const THERMAL_MARGIN_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Thermal thermal-margin snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Thermal thermal-margin requires a system-facts snapshot');
  if (!isRecord(snapshot.thermal)) throw new TypeError('Thermal thermal-margin snapshot requires a thermal object');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const temperature = nonNegative(source.thermal.temperatureCelsius);
  const critical = nonNegative(source.thermal.criticalCelsius); const headroom = temperature === null || critical === null ? null : critical - temperature;
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', temperature, critical, headroom, observed: headroom !== null });
}
function requireTrigger(trigger) {
  if (!THERMAL_MARGIN_TRIGGERS.includes(trigger)) throw new Error(`Unsupported thermal thermal-margin trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Thermal thermal-margin windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Thermal thermal-margin minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Thermal thermal-margin persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Thermal thermal-margin clock must return a number'); return timestamp; }
function comparisons(evidence) {
  return evidence.slice(1).map((current, index) => {
    const previous = evidence[index]; const delta = previous.headroom === null || current.headroom === null ? null : current.headroom - previous.headroom;
    return Object.freeze({ falling: delta !== null && delta < 0, rising: delta !== null && delta > 0, changed: delta !== null && delta !== 0 });
  });
}
function stateFor(sampleCount, minimumSamples, observedCount, finalHeadroom, fallingCount, risingCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'margin-unknown';
  if (observedCount < sampleCount) return 'observation-required';
  if (finalHeadroom !== null && finalHeadroom <= 0) return 'critical-margin';
  if (fallingCount >= persistenceThreshold) return 'margin-collapse-sustained';
  if (fallingCount > 0) return 'margin-collapse-observed';
  if (finalHeadroom !== null && finalHeadroom < 10) return 'low-margin';
  if (risingCount > 0) return 'margin-recovery-observed';
  return 'stable-margin';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-thermal-margin-samples']);
  if (state === 'margin-unknown') return Object.freeze(['request-thermal-margin-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-thermal-margin-observation']);
  if (state === 'critical-margin') return Object.freeze(['protect-thermal-headroom', 'request-user-approved-thermal-response']);
  if (state === 'margin-collapse-sustained') return Object.freeze(['review-thermal-margin-collapse-without-mutation']);
  if (state === 'margin-collapse-observed') return Object.freeze(['observe-thermal-margin-stability']);
  if (state === 'low-margin') return Object.freeze(['review-low-thermal-margin']);
  if (state === 'margin-recovery-observed') return Object.freeze(['observe-thermal-margin-recovery']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runThermalMarginTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Thermal thermal-margin samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const changes = comparisons(evidence);
  const observedCount = evidence.filter((item) => item.observed).length; const fallingCount = changes.filter((item) => item.falling).length;
  const risingCount = changes.filter((item) => item.rising).length; const final = evidence.at(-1);
  const state = stateFor(selected.length, requiredSamples, observedCount, final?.headroom ?? null, fallingCount, risingCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: THERMAL_MARGIN_TURBO_ID, turboVersion: THERMAL_MARGIN_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, observedCount, unknownCount: selected.length - observedCount,
    comparisonCount: changes.length, changedCount: changes.filter((item) => item.changed).length, fallingCount, risingCount,
    finalHeadroomCelsius: final?.headroom ?? null, finalTemperatureCelsius: final?.temperature ?? null,
    finalCriticalCelsius: final?.critical ?? null, finalEnvironment: final?.environment || 'unknown', state,
    confidence: confidence(selected.length, observedCount, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
