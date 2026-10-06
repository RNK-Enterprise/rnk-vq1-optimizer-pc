/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Battery charge-ceiling turbo. It measures explicit ceiling persistence and
 * charge movement without imposing a charge limit or changing charging.
 */
export const BATTERY_CHARGE_CEILING_TURBO_ID = 'battery.charge-ceiling';
export const BATTERY_CHARGE_CEILING_TURBO_VERSION = 1;
export const BATTERY_CHARGE_CEILING_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function chargeOf(value) { return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null; }
function booleanOrNull(value) { return typeof value === 'boolean' ? value : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Battery charge-ceiling snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Battery charge-ceiling requires a system-facts snapshot');
  if (!isRecord(snapshot.battery)) throw new TypeError('Battery charge-ceiling snapshot requires a battery object');
  return snapshot;
}
function evidenceOf(snapshot, ceilingPercent) {
  const source = requireSnapshot(snapshot); const charge = chargeOf(source.battery.chargePercent);
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', charge,
    charging: booleanOrNull(source.battery.charging), present: booleanOrNull(source.battery.present),
    ceilingReached: charge !== null && charge >= ceilingPercent });
}
function requireTrigger(trigger) {
  if (!BATTERY_CHARGE_CEILING_TRIGGERS.includes(trigger)) throw new Error(`Unsupported battery charge-ceiling trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Battery charge-ceiling windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Battery charge-ceiling minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(name, value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`Battery charge-ceiling ${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Battery charge-ceiling clock must return a number'); return timestamp; }
function comparisons(evidence, movementThreshold) {
  return evidence.slice(1).map((current, index) => {
    const previous = evidence[index]; const delta = previous.charge === null || current.charge === null ? null : Math.abs(current.charge - previous.charge);
    return Object.freeze({ ceilingChanged: previous.ceilingReached !== current.ceilingReached, moved: delta !== null && delta >= movementThreshold });
  });
}
function stateFor(sampleCount, minimumSamples, observedCount, final, ceilingCount, movementCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (final?.present === false) return 'no-battery';
  if (observedCount === 0) return 'ceiling-unknown';
  if (observedCount < sampleCount) return 'observation-required';
  if (final?.ceilingReached && ceilingCount >= persistenceThreshold) return 'ceiling-held';
  if (final?.ceilingReached) return 'ceiling-observed';
  if (movementCount >= persistenceThreshold) return 'charge-movement-sustained';
  if (movementCount > 0) return 'charge-movement-observed';
  return 'stable-ceiling';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-ceiling-samples']);
  if (state === 'no-battery') return Object.freeze(['keep-battery-controls-disabled']);
  if (state === 'ceiling-unknown') return Object.freeze(['request-ceiling-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-ceiling-observation']);
  if (state === 'ceiling-held') return Object.freeze(['review-ceiling-evidence-without-limit-change']);
  if (state === 'ceiling-observed') return Object.freeze(['observe-charge-ceiling']);
  if (state === 'charge-movement-sustained') return Object.freeze(['review-charge-movement-without-control-change']);
  if (state === 'charge-movement-observed') return Object.freeze(['observe-charge-movement']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runBatteryChargeCeilingTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, ceilingPercent = 95, movementThreshold = 5, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Battery charge-ceiling samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold('persistenceThreshold', persistenceThreshold, 1, boundedWindow);
  const requiredCeiling = requireThreshold('ceilingPercent', ceilingPercent, 50, 100); const requiredMovement = requireThreshold('movementThreshold', movementThreshold, 1, 50);
  const selected = samples.slice(-boundedWindow); const timestamp = requireClock(now); const evidence = selected.map((sample) => evidenceOf(sample, requiredCeiling));
  const changes = comparisons(evidence, requiredMovement); const observedCount = evidence.filter((item) => item.charge !== null && item.charging !== null).length;
  const final = evidence.at(-1); const ceilingCount = evidence.filter((item) => item.ceilingReached).length; const movementCount = changes.filter((item) => item.moved).length;
  const state = stateFor(selected.length, requiredSamples, observedCount, final, ceilingCount, movementCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: BATTERY_CHARGE_CEILING_TURBO_ID, turboVersion: BATTERY_CHARGE_CEILING_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, ceilingPercent: requiredCeiling, movementThreshold: requiredMovement, observedCount,
    unknownCount: selected.length - observedCount, comparisonCount: changes.length, ceilingCount, movementCount,
    finalChargePercent: final?.charge ?? null, finalPresent: final?.present ?? null, finalCharging: final?.charging ?? null,
    finalEnvironment: final?.environment || 'unknown', state, confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
