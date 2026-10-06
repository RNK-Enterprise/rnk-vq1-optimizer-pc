/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Sensor-stability turbo. It measures bounded thermal sensor jitter and
 * completeness without changing sensors, fans, governors, or power state.
 */
export const THERMAL_SENSOR_STABILITY_TURBO_ID = 'thermal.sensor-stability';
export const THERMAL_SENSOR_STABILITY_TURBO_VERSION = 1;
export const THERMAL_SENSOR_STABILITY_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function percent(value) { return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Thermal sensor-stability snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Thermal sensor-stability requires a system-facts snapshot');
  if (!isRecord(snapshot.thermal)) throw new TypeError('Thermal sensor-stability snapshot requires a thermal object');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const temperature = nonNegative(source.thermal.temperatureCelsius);
  const critical = nonNegative(source.thermal.criticalCelsius); const fanPercent = percent(source.thermal.fanPercent);
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', temperature, critical, fanPercent,
    observed: temperature !== null && critical !== null, complete: temperature !== null && critical !== null && fanPercent !== null });
}
function requireTrigger(trigger) {
  if (!THERMAL_SENSOR_STABILITY_TRIGGERS.includes(trigger)) throw new Error(`Unsupported thermal sensor-stability trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Thermal sensor-stability windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Thermal sensor-stability minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0.1 || value > 50) throw new RangeError('Thermal sensor-stability jitterThreshold must be from 0.1 to 50');
  return value;
}
function requirePersistence(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Thermal sensor-stability persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Thermal sensor-stability clock must return a number'); return timestamp; }
function comparisons(evidence, jitterThreshold) {
  return evidence.slice(1).map((current, index) => {
    const previous = evidence[index]; const temperatureDelta = previous.temperature === null || current.temperature === null ? null : current.temperature - previous.temperature;
    const fanDelta = previous.fanPercent === null || current.fanPercent === null ? null : current.fanPercent - previous.fanPercent;
    const jitter = temperatureDelta !== null && Math.abs(temperatureDelta) >= jitterThreshold;
    const fanJitter = fanDelta !== null && Math.abs(fanDelta) >= jitterThreshold * 2;
    return Object.freeze({ changed: temperatureDelta !== null && temperatureDelta !== 0 || fanDelta !== null && fanDelta !== 0, jitter: jitter || fanJitter });
  });
}
function stateFor(sampleCount, minimumSamples, observedCount, completeCount, jitterCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'sensor-unknown';
  if (observedCount < sampleCount || completeCount < sampleCount) return 'sensor-evidence-required';
  if (jitterCount >= persistenceThreshold) return 'sensor-jitter-sustained';
  if (jitterCount > 0) return 'sensor-jitter-observed';
  return 'stable-sensor';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-thermal-sensor-samples']);
  if (state === 'sensor-unknown') return Object.freeze(['request-thermal-sensor-observation']);
  if (state === 'sensor-evidence-required') return Object.freeze(['request-complete-thermal-sensor-evidence']);
  if (state === 'sensor-jitter-sustained') return Object.freeze(['review-thermal-sensor-jitter-without-mutation']);
  if (state === 'sensor-jitter-observed') return Object.freeze(['observe-thermal-sensor-stability']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, completeCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((completeCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runThermalSensorStabilityTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, jitterThreshold = 5, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Thermal sensor-stability samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredJitter = requireThreshold(jitterThreshold); const requiredPersistence = requirePersistence(persistenceThreshold, boundedWindow);
  const selected = samples.slice(-boundedWindow); const timestamp = requireClock(now); const evidence = selected.map(evidenceOf);
  const changes = comparisons(evidence, requiredJitter); const observedCount = evidence.filter((item) => item.observed).length;
  const completeCount = evidence.filter((item) => item.complete).length; const jitterCount = changes.filter((item) => item.jitter).length; const final = evidence.at(-1);
  const state = stateFor(selected.length, requiredSamples, observedCount, completeCount, jitterCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: THERMAL_SENSOR_STABILITY_TURBO_ID, turboVersion: THERMAL_SENSOR_STABILITY_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    jitterThreshold: requiredJitter, persistenceThreshold: requiredPersistence, observedCount, completeCount, unknownCount: selected.length - observedCount,
    comparisonCount: changes.length, changedCount: changes.filter((item) => item.changed).length, jitterCount,
    finalTemperatureCelsius: final?.temperature ?? null, finalFanPercent: final?.fanPercent ?? null, finalEnvironment: final?.environment || 'unknown',
    state, confidence: confidence(selected.length, completeCount, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
