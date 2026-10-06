/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Cooldown-recovery turbo. It measures bounded temperature recovery and
 * rebound without changing fans, governors, workloads, or power state.
 */
export const THERMAL_COOLDOWN_RECOVERY_TURBO_ID = 'thermal.cooldown-recovery';
export const THERMAL_COOLDOWN_RECOVERY_TURBO_VERSION = 1;
export const THERMAL_COOLDOWN_RECOVERY_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Thermal cooldown-recovery snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Thermal cooldown-recovery requires a system-facts snapshot');
  if (!isRecord(snapshot.thermal)) throw new TypeError('Thermal cooldown-recovery snapshot requires a thermal object');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const temperature = nonNegative(source.thermal.temperatureCelsius);
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', temperature, observed: temperature !== null });
}
function requireTrigger(trigger) {
  if (!THERMAL_COOLDOWN_RECOVERY_TRIGGERS.includes(trigger)) throw new Error(`Unsupported thermal cooldown-recovery trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Thermal cooldown-recovery windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Thermal cooldown-recovery minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Thermal cooldown-recovery persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Thermal cooldown-recovery clock must return a number'); return timestamp; }
function comparisons(evidence) {
  return evidence.slice(1).map((current, index) => {
    const previous = evidence[index]; const delta = previous.temperature === null || current.temperature === null ? null : current.temperature - previous.temperature;
    return Object.freeze({ recovering: delta !== null && delta < 0, rebound: delta !== null && delta > 0, changed: delta !== null && delta !== 0 });
  });
}
function stateFor(sampleCount, minimumSamples, observedCount, recoveryCount, reboundCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'recovery-unknown';
  if (observedCount < sampleCount) return 'observation-required';
  if (recoveryCount >= persistenceThreshold) return 'cooldown-recovery-sustained';
  if (reboundCount >= persistenceThreshold) return 'thermal-rebound-sustained';
  if (recoveryCount > 0) return 'cooldown-recovery-observed';
  if (reboundCount > 0) return 'thermal-rebound-observed';
  return 'stable-temperature';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cooldown-samples']);
  if (state === 'recovery-unknown') return Object.freeze(['request-cooldown-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-cooldown-observation']);
  if (state === 'cooldown-recovery-sustained') return Object.freeze(['observe-cooldown-recovery']);
  if (state === 'thermal-rebound-sustained') return Object.freeze(['review-thermal-rebound-without-mutation']);
  if (state === 'cooldown-recovery-observed') return Object.freeze(['observe-cooldown-stability']);
  if (state === 'thermal-rebound-observed') return Object.freeze(['observe-thermal-rebound-stability']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runThermalCooldownRecoveryTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Thermal cooldown-recovery samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const changes = comparisons(evidence);
  const observedCount = evidence.filter((item) => item.observed).length; const recoveryCount = changes.filter((item) => item.recovering).length;
  const reboundCount = changes.filter((item) => item.rebound).length; const final = evidence.at(-1);
  const state = stateFor(selected.length, requiredSamples, observedCount, recoveryCount, reboundCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: THERMAL_COOLDOWN_RECOVERY_TURBO_ID, turboVersion: THERMAL_COOLDOWN_RECOVERY_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, observedCount, unknownCount: selected.length - observedCount,
    comparisonCount: changes.length, changedCount: changes.filter((item) => item.changed).length, recoveryCount, reboundCount,
    finalTemperatureCelsius: final?.temperature ?? null, finalEnvironment: final?.environment || 'unknown', state,
    confidence: confidence(selected.length, observedCount, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
