/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Startup requiredness-drift turbo. It compares required-flag evidence
 * without disabling entries, changing boot configuration, or editing files.
 */
export const STARTUP_REQUIREDNESS_DRIFT_TURBO_ID = 'startup.requiredness-drift';
export const STARTUP_REQUIREDNESS_DRIFT_TURBO_VERSION = 1;
export const STARTUP_REQUIREDNESS_DRIFT_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Startup requiredness-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Startup requiredness-drift requires a system-facts snapshot');
  if (!Array.isArray(snapshot.startup)) throw new TypeError('Startup requiredness-drift snapshot requires a startup list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot); const entries = source.startup.filter(isRecord);
  const signature = entries.map((entry) => `${text(entry.name) || 'unknown'}:${entry.required === true}`).join('|');
  return Object.freeze({ environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown', entryCount: entries.length,
    requiredCount: entries.filter((entry) => entry.required === true).length, requiredDisabledCount: entries.filter((entry) => entry.required === true && entry.enabled === false).length, signature });
}
function requireTrigger(trigger) {
  if (!STARTUP_REQUIREDNESS_DRIFT_TRIGGERS.includes(trigger)) throw new Error(`Unsupported startup requiredness-drift trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Startup requiredness-drift windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Startup requiredness-drift minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Startup requiredness-drift persistenceThreshold must be an integer from 1 to the window size');
  return value;
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Startup requiredness-drift clock must return a number'); return timestamp; }
function stateFor(sampleCount, minimumSamples, latest, changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (latest?.entryCount === 0) return 'no-startup-items';
  if (latest?.requiredDisabledCount > 0) return 'required-disabled-review';
  if (changeCount >= persistenceThreshold) return 'requiredness-drift-sustained';
  if (changeCount > 0) return 'requiredness-drift-observed';
  return 'stable-requiredness';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-startup-requiredness-samples']);
  if (state === 'no-startup-items') return Object.freeze(['no-startup-review']);
  if (state === 'required-disabled-review') return Object.freeze(['review-required-startup-owner']);
  if (state === 'requiredness-drift-sustained') return Object.freeze(['review-startup-requiredness-drift-without-mutation']);
  if (state === 'requiredness-drift-observed') return Object.freeze(['observe-startup-requiredness-stability']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, latest, minimumSamples) {
  if (sampleCount === 0) return 0;
  const quality = latest.entryCount === 0 ? 0.25 : 1;
  return Math.round(quality * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}
export function runStartupRequirednessDriftTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Startup requiredness-drift samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow); const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now); const evidence = selected.map(evidenceOf); const latest = evidence.at(-1);
  const changeCount = evidence.slice(1).filter((current, index) => current.signature !== evidence[index].signature).length;
  const state = stateFor(selected.length, requiredSamples, latest, changeCount, requiredPersistence);
  return Object.freeze({ protocolVersion: 1, turbo: STARTUP_REQUIREDNESS_DRIFT_TURBO_ID, turboVersion: STARTUP_REQUIREDNESS_DRIFT_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence, entryCount: latest?.entryCount || 0, requiredCount: latest?.requiredCount || 0,
    requiredDisabledCount: latest?.requiredDisabledCount || 0, comparisonCount: Math.max(0, selected.length - 1), changeCount,
    finalEnvironment: latest?.environment || 'unknown', state, confidence: confidence(selected.length, latest || { entryCount: 0 }, requiredSamples),
    recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
