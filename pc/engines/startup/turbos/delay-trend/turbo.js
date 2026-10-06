/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Startup delay-trend turbo. It compares bounded maximum-delay evidence
 * without disabling entries, changing boot configuration, or editing files.
 */
export const STARTUP_DELAY_TREND_TURBO_ID = 'startup.delay-trend';
export const STARTUP_DELAY_TREND_TURBO_VERSION = 1;
export const STARTUP_DELAY_TREND_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Startup delay-trend snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Startup delay-trend requires a system-facts snapshot');
  if (!Array.isArray(snapshot.startup)) throw new TypeError('Startup delay-trend snapshot requires a startup list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const entries = source.startup.filter(isRecord);
  const delays = entries.map((entry) => nonNegative(entry.delayMs)).filter((delay) => delay !== null);
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', entryCount: entries.length,
    maximumDelayMs: delays.length === 0 ? null : Math.max(...delays), observed: delays.length > 0 });
}
function requireTrigger(trigger) {
  if (!STARTUP_DELAY_TREND_TRIGGERS.includes(trigger)) throw new Error(`Unsupported startup delay-trend trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Startup delay-trend windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Startup delay-trend minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 1 || value > 5000) throw new RangeError('Startup delay-trend delayThresholdMs must be from 1 to 5000');
  return value;
}
function requirePersistence(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Startup delay-trend persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Startup delay-trend clock must return a number'); return timestamp; }
function comparisons(evidence, delayThresholdMs) {
  return evidence.slice(1).map((current, index) => {
    const previous = evidence[index]; const delta = previous.maximumDelayMs === null || current.maximumDelayMs === null ? null : current.maximumDelayMs - previous.maximumDelayMs;
    return Object.freeze({ rising: delta !== null && delta >= delayThresholdMs, falling: delta !== null && delta <= -delayThresholdMs, changed: delta !== null && delta !== 0 });
  });
}
function stateFor(sampleCount, minimumSamples, latest, observedCount, risingCount, fallingCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (latest?.entryCount === 0) return 'no-startup-items';
  if (observedCount === 0) return 'delay-unknown';
  if (observedCount < sampleCount) return 'delay-observation-required';
  if (risingCount >= persistenceThreshold) return 'delay-rising-sustained';
  if (fallingCount >= persistenceThreshold) return 'delay-falling-sustained';
  if (risingCount > 0) return 'delay-rising-observed';
  if (fallingCount > 0) return 'delay-falling-observed';
  return 'stable-delay';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-startup-delay-samples']);
  if (state === 'no-startup-items') return Object.freeze(['no-startup-review']);
  if (state === 'delay-unknown') return Object.freeze(['request-startup-delay-observation']);
  if (state === 'delay-observation-required') return Object.freeze(['request-complete-startup-delay-observation']);
  if (state === 'delay-rising-sustained') return Object.freeze(['review-startup-delay-growth-without-mutation']);
  if (state === 'delay-falling-sustained') return Object.freeze(['observe-startup-delay-recovery']);
  if (state === 'delay-rising-observed') return Object.freeze(['observe-startup-delay-stability']);
  if (state === 'delay-falling-observed') return Object.freeze(['observe-startup-delay-recovery']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runStartupDelayTrendTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, delayThresholdMs = 50, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Startup delay-trend samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredDelay = requireThreshold(delayThresholdMs); const requiredPersistence = requirePersistence(persistenceThreshold, boundedWindow);
  const selected = samples.slice(-boundedWindow); const timestamp = requireClock(now); const evidence = selected.map(evidenceOf);
  const changes = comparisons(evidence, requiredDelay); const observedCount = evidence.filter((item) => item.observed).length;
  const risingCount = changes.filter((item) => item.rising).length; const fallingCount = changes.filter((item) => item.falling).length; const latest = evidence.at(-1);
  const state = stateFor(selected.length, requiredSamples, latest, observedCount, risingCount, fallingCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: STARTUP_DELAY_TREND_TURBO_ID, turboVersion: STARTUP_DELAY_TREND_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    delayThresholdMs: requiredDelay, persistenceThreshold: requiredPersistence, observedCount, unknownCount: selected.length - observedCount,
    comparisonCount: changes.length, changedCount: changes.filter((item) => item.changed).length, risingCount, fallingCount,
    finalMaximumDelayMs: latest?.maximumDelayMs ?? null, finalEntryCount: latest?.entryCount || 0, finalEnvironment: latest?.environment || 'unknown',
    state, confidence: confidence(selected.length, observedCount, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
