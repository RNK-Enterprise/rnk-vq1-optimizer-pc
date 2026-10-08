/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Battery health-boundary turbo. It measures explicit health evidence and
 * refuses to infer health or permission to change a battery policy.
 */
export const BATTERY_HEALTH_BOUNDARY_TURBO_ID = 'battery.health-boundary';
export const BATTERY_HEALTH_BOUNDARY_TURBO_VERSION = 1;
export const BATTERY_HEALTH_BOUNDARY_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'failed', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function healthOf(value) {
  if (typeof value !== 'string') return 'unknown'; const normalized = value.trim().toLowerCase();
  return HEALTH_STATES.includes(normalized) ? normalized : 'unknown';
}
function presentOf(value) { return typeof value === 'boolean' ? value : null; }
function rankOf(health) { return health === 'healthy' ? 0 : health === 'degraded' ? 1 : health === 'failed' ? 2 : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Battery health-boundary snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Battery health-boundary requires a system-facts snapshot');
  if (!isRecord(snapshot.battery)) throw new TypeError('Battery health-boundary snapshot requires a battery object');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const health = healthOf(source.battery.health);
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    health, present: presentOf(source.battery.present), observed: health !== 'unknown' });
}
function requireTrigger(trigger) {
  if (!BATTERY_HEALTH_BOUNDARY_TRIGGERS.includes(trigger)) throw new Error(`Unsupported battery health-boundary trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Battery health-boundary windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Battery health-boundary minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Battery health-boundary persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Battery health-boundary clock must return a number'); return timestamp; }
function comparisons(evidence) {
  return evidence.slice(1).map((current, index) => {
    const previous = evidence[index]; const before = rankOf(previous.health); const after = rankOf(current.health);
    return Object.freeze({ changed: before !== null && after !== null && before !== after, degraded: before !== null && after !== null && after > before });
  });
}
function stateFor(sampleCount, minimumSamples, observedCount, final, changedCount, degradationCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (final?.present === false) return 'no-battery';
  if (observedCount === 0) return 'health-unknown';
  if (observedCount < sampleCount) return 'observation-required';
  if (final?.health === 'failed') return 'protect-health';
  if (degradationCount >= persistenceThreshold) return 'health-degradation-sustained';
  if (changedCount > 0) return 'health-drift-observed';
  return 'stable-health';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-health-samples']);
  if (state === 'no-battery') return Object.freeze(['keep-battery-controls-disabled']);
  if (state === 'health-unknown') return Object.freeze(['request-health-observation']);
  if (state === 'observation-required') return Object.freeze(['request-complete-health-observation']);
  if (state === 'protect-health') return Object.freeze(['protect-power', 'request-user-approved-battery-review']);
  if (state === 'health-degradation-sustained') return Object.freeze(['review-battery-health-without-policy-change']);
  if (state === 'health-drift-observed') return Object.freeze(['observe-health-stability']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runBatteryHealthBoundaryTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Battery health-boundary samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const changes = comparisons(evidence);
  const observedCount = evidence.filter((item) => item.observed).length; const changedCount = changes.filter((item) => item.changed).length;
  const degradationCount = changes.filter((item) => item.degraded).length; const final = evidence.at(-1);
  const state = stateFor(selected.length, requiredSamples, observedCount, final, changedCount, degradationCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: BATTERY_HEALTH_BOUNDARY_TURBO_ID, turboVersion: BATTERY_HEALTH_BOUNDARY_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, observedCount, unknownCount: selected.length - observedCount, comparisonCount: changes.length,
    changedCount, degradationCount, finalHealth: final?.health || 'unknown', finalPresent: final?.present ?? null,
    finalEnvironment: final?.environment || 'unknown', state, confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
