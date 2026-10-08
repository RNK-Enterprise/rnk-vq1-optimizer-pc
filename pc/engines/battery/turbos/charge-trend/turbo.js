/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Battery charge-trend turbo. It measures bounded charge movement and never
 * changes charging, power policy, files, or transport state.
 */
export const BATTERY_CHARGE_TREND_TURBO_ID = 'battery.charge-trend';
export const BATTERY_CHARGE_TREND_TURBO_VERSION = 1;
export const BATTERY_CHARGE_TREND_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function chargeOf(value) { return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null; }
function chargingOf(value) { return typeof value === 'boolean' ? value : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Battery charge-trend snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Battery charge-trend requires a system-facts snapshot');
  if (!isRecord(snapshot.battery)) throw new TypeError('Battery charge-trend snapshot requires a battery object');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const charge = chargeOf(source.battery.chargePercent);
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    charge, charging: chargingOf(source.battery.charging), observed: charge !== null });
}
function requireTrigger(trigger) {
  if (!BATTERY_CHARGE_TREND_TRIGGERS.includes(trigger)) throw new Error(`Unsupported battery charge-trend trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Battery charge-trend windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Battery charge-trend minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Battery charge-trend persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) {
  const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Battery charge-trend clock must return a number'); return timestamp;
}
function comparisons(evidence) {
  return evidence.slice(1).map((current, index) => {
    const previous = evidence[index]; const delta = previous.charge === null || current.charge === null ? null : current.charge - previous.charge;
    return Object.freeze({ rising: delta !== null && delta > 0, falling: delta !== null && delta < 0, changed: delta !== null && delta !== 0 });
  });
}
function stateFor(sampleCount, minimumSamples, observedCount, finalCharge, risingCount, fallingCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'charge-unknown';
  if (observedCount < sampleCount) return 'observation-required';
  if (finalCharge !== null && finalCharge <= 10) return 'low-charge';
  if (fallingCount >= persistenceThreshold) return 'charge-falling-sustained';
  if (risingCount >= persistenceThreshold) return 'charge-rising-sustained';
  if (risingCount > 0 || fallingCount > 0) return 'charge-drift-observed';
  return 'stable-charge';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-charge-samples']);
  if (state === 'charge-unknown') return Object.freeze(['request-charge-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-charge-observation']);
  if (state === 'low-charge') return Object.freeze(['review-user-owned-power-policy']);
  if (state === 'charge-falling-sustained') return Object.freeze(['review-charge-loss-without-charging-change']);
  if (state === 'charge-rising-sustained') return Object.freeze(['observe-charge-recovery']);
  if (state === 'charge-drift-observed') return Object.freeze(['observe-charge-stability']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runBatteryChargeTrendTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Battery charge-trend samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const changes = comparisons(evidence);
  const observedCount = evidence.filter((item) => item.observed).length; const risingCount = changes.filter((item) => item.rising).length;
  const fallingCount = changes.filter((item) => item.falling).length; const final = evidence.at(-1);
  const state = stateFor(selected.length, requiredSamples, observedCount, final?.charge ?? null, risingCount, fallingCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: BATTERY_CHARGE_TREND_TURBO_ID, turboVersion: BATTERY_CHARGE_TREND_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, observedCount, unknownCount: selected.length - observedCount,
    comparisonCount: changes.length, changedCount: changes.filter((item) => item.changed).length, risingCount, fallingCount,
    finalChargePercent: final?.charge ?? null, finalCharging: final?.charging ?? null, finalEnvironment: final?.environment || 'unknown',
    state, confidence: confidence(selected.length, observedCount, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
