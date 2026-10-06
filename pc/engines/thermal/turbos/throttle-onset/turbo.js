/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Throttle-onset turbo. It tracks normalized temperature-ratio bands and
 * threshold crossings without changing governors, fans, workloads, or power.
 */
export const THERMAL_THROTTLE_ONSET_TURBO_ID = 'thermal.throttle-onset';
export const THERMAL_THROTTLE_ONSET_TURBO_VERSION = 1;
export const THERMAL_THROTTLE_ONSET_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const BANDS = Object.freeze(['below-threshold', 'watch-threshold', 'throttle-risk', 'critical-threshold', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function ratioOf(temperature, critical) { return temperature === null || critical === null || critical <= 0 ? null : (temperature / critical) * 100; }
function bandOf(ratio) {
  if (ratio === null) return 'unknown';
  if (ratio >= 100) return 'critical-threshold';
  if (ratio >= 90) return 'throttle-risk';
  if (ratio >= 80) return 'watch-threshold';
  return 'below-threshold';
}
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Thermal throttle-onset snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Thermal throttle-onset requires a system-facts snapshot');
  if (!isRecord(snapshot.thermal)) throw new TypeError('Thermal throttle-onset snapshot requires a thermal object');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const temperature = nonNegative(source.thermal.temperatureCelsius);
  const critical = nonNegative(source.thermal.criticalCelsius); const ratio = ratioOf(temperature, critical);
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', temperature, critical, ratio, band: bandOf(ratio), observed: ratio !== null });
}
function requireTrigger(trigger) {
  if (!THERMAL_THROTTLE_ONSET_TRIGGERS.includes(trigger)) throw new Error(`Unsupported thermal throttle-onset trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Thermal throttle-onset windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Thermal throttle-onset minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Thermal throttle-onset persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Thermal throttle-onset clock must return a number'); return timestamp; }
function comparisons(evidence) {
  return evidence.slice(1).map((current, index) => {
    const previous = evidence[index]; const crossing = previous.band !== current.band && previous.band !== 'unknown' && current.band !== 'unknown';
    const entersRisk = previous.ratio !== null && current.ratio !== null && previous.ratio < 90 && current.ratio >= 90;
    return Object.freeze({ crossing, entersRisk, changed: crossing || entersRisk });
  });
}
function stateFor(sampleCount, minimumSamples, observedCount, finalBand, riskCount, crossingCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'threshold-unknown';
  if (observedCount < sampleCount) return 'observation-required';
  if (finalBand === 'critical-threshold') return 'critical-threshold';
  if (riskCount >= persistenceThreshold) return 'throttle-risk-sustained';
  if (finalBand === 'throttle-risk') return 'throttle-risk';
  if (finalBand === 'watch-threshold') return 'watch-threshold';
  if (crossingCount >= persistenceThreshold) return 'threshold-crossing-sustained';
  if (crossingCount > 0) return 'threshold-crossing-observed';
  return 'below-threshold';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-throttle-onset-samples']);
  if (state === 'threshold-unknown') return Object.freeze(['request-throttle-onset-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-throttle-onset-observation']);
  if (state === 'critical-threshold') return Object.freeze(['protect-critical-thermal-threshold', 'request-user-approved-thermal-response']);
  if (state === 'throttle-risk-sustained') return Object.freeze(['review-throttle-risk-without-mutation']);
  if (state === 'throttle-risk') return Object.freeze(['observe-throttle-onset']);
  if (state === 'watch-threshold') return Object.freeze(['observe-thermal-threshold']);
  if (state === 'threshold-crossing-sustained') return Object.freeze(['review-thermal-threshold-churn']);
  if (state === 'threshold-crossing-observed') return Object.freeze(['observe-thermal-threshold-stability']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runThermalThrottleOnsetTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Thermal throttle-onset samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const changes = comparisons(evidence);
  const observedCount = evidence.filter((item) => item.observed).length; const riskCount = evidence.filter((item) => item.band === 'throttle-risk').length;
  const crossingCount = changes.filter((item) => item.crossing).length; const final = evidence.at(-1);
  const state = stateFor(selected.length, requiredSamples, observedCount, final?.band || 'unknown', riskCount, crossingCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: THERMAL_THROTTLE_ONSET_TURBO_ID, turboVersion: THERMAL_THROTTLE_ONSET_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, observedCount, unknownCount: selected.length - observedCount,
    comparisonCount: changes.length, changedCount: changes.filter((item) => item.changed).length, crossingCount, riskCount,
    finalRatioPercent: final?.ratio ?? null, finalBand: final?.band || 'unknown', finalEnvironment: final?.environment || 'unknown',
    state, confidence: confidence(selected.length, observedCount, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
