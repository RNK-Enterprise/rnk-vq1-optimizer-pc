/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Battery power-source-drift turbo. It measures explicit presence and
 * charging transitions without toggling charging or power policy.
 */
export const BATTERY_POWER_SOURCE_DRIFT_TURBO_ID = 'battery.power-source-drift';
export const BATTERY_POWER_SOURCE_DRIFT_TURBO_VERSION = 1;
export const BATTERY_POWER_SOURCE_DRIFT_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function booleanOrNull(value) { return typeof value === 'boolean' ? value : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Battery power-source-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Battery power-source-drift requires a system-facts snapshot');
  if (!isRecord(snapshot.battery)) throw new TypeError('Battery power-source-drift snapshot requires a battery object');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    present: booleanOrNull(source.battery.present), charging: booleanOrNull(source.battery.charging) });
}
function requireTrigger(trigger) {
  if (!BATTERY_POWER_SOURCE_DRIFT_TRIGGERS.includes(trigger)) throw new Error(`Unsupported battery power-source-drift trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Battery power-source-drift windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Battery power-source-drift minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Battery power-source-drift persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Battery power-source-drift clock must return a number'); return timestamp; }
function comparisons(evidence) {
  return evidence.slice(1).map((current, index) => {
    const previous = evidence[index];
    return Object.freeze({ presenceChanged: previous.present !== null && current.present !== null && previous.present !== current.present,
      chargingChanged: previous.charging !== null && current.charging !== null && previous.charging !== current.charging });
  });
}
function stateFor(sampleCount, minimumSamples, observedCount, final, unknownCount, presenceChangeCount, chargingChangeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'source-unknown';
  if (final?.present === false) return 'no-battery';
  if (unknownCount > 0) return 'observation-required';
  if (presenceChangeCount >= persistenceThreshold || chargingChangeCount >= persistenceThreshold) return 'source-drift-sustained';
  if (presenceChangeCount > 0 || chargingChangeCount > 0) return 'source-drift-observed';
  return 'stable-source';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-power-source-samples']);
  if (state === 'source-unknown') return Object.freeze(['request-power-source-observation']);
  if (state === 'no-battery') return Object.freeze(['keep-battery-controls-disabled']);
  if (state === 'observation-required') return Object.freeze(['request-complete-power-source-observation']);
  if (state === 'source-drift-sustained') return Object.freeze(['review-power-source-drift-without-control-change']);
  if (state === 'source-drift-observed') return Object.freeze(['observe-power-source-stability']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runBatteryPowerSourceDriftTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Battery power-source-drift samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const changes = comparisons(evidence);
  const observedCount = evidence.filter((item) => item.present !== null && item.charging !== null).length;
  const unknownCount = selected.length - observedCount; const presenceChangeCount = changes.filter((item) => item.presenceChanged).length;
  const chargingChangeCount = changes.filter((item) => item.chargingChanged).length; const final = evidence.at(-1);
  const state = stateFor(selected.length, requiredSamples, observedCount, final, unknownCount, presenceChangeCount, chargingChangeCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: BATTERY_POWER_SOURCE_DRIFT_TURBO_ID, turboVersion: BATTERY_POWER_SOURCE_DRIFT_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, observedCount, unknownCount, comparisonCount: changes.length,
    presenceChangeCount, chargingChangeCount, finalPresent: final?.present ?? null, finalCharging: final?.charging ?? null,
    finalEnvironment: final?.environment || 'unknown', state, confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
