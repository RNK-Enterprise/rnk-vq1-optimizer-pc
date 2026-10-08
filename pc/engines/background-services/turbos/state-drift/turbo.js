/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Background-services state-drift turbo. It compares explicit service state
 * evidence without starting, stopping, disabling, or editing services.
 */

export const BACKGROUND_STATE_DRIFT_TURBO_ID = 'background-services.state-drift';
export const BACKGROUND_STATE_DRIFT_TURBO_VERSION = 1;
export const BACKGROUND_STATE_DRIFT_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const STATES = Object.freeze(['running', 'stopped', 'failed']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function stateOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
  const normalized = value.trim().toLowerCase();
  return STATES.includes(normalized) ? normalized : 'unknown';
}
function text(value) { return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null; }

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Background-services state-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Background-services state-drift requires a system-facts snapshot');
  if (!Array.isArray(snapshot.services)) throw new TypeError('Background-services state-drift snapshot requires a service list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.services.filter(isRecord).map((service) => ({
    name: text(service.name), state: stateOf(service.state), critical: service.critical === true
  }));
  const named = rows.filter((row) => row.name !== null);
  return Object.freeze({
    environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    rows: Object.freeze(rows),
    signature: rows.map((row) => `${row.name || '?'}:${row.state}`).join('|'),
    serviceCount: rows.length,
    namedCount: named.length,
    runningCount: rows.filter((row) => row.state === 'running').length,
    stoppedCount: rows.filter((row) => row.state === 'stopped').length,
    failedCount: rows.filter((row) => row.state === 'failed').length,
    unknownCount: rows.filter((row) => row.state === 'unknown').length,
    criticalFailureCount: rows.filter((row) => row.critical && row.state === 'failed').length
  });
}
function requireTrigger(trigger) {
  if (!BACKGROUND_STATE_DRIFT_TRIGGERS.includes(trigger)) throw new Error(`Unsupported background-services state-drift trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindowSize(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Background-services state-drift windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Background-services state-drift minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError(`Background-services state-drift persistenceThreshold must be an integer from 1 to ${windowSize}`);
  return value;
}
function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Background-services state-drift clock must return a number');
  return timestamp;
}
function stateFor(sampleCount, minimumSamples, serviceCount, criticalFailureCount, unknownCount, changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (serviceCount === 0) return 'no-services';
  if (criticalFailureCount > 0) return 'protect-services';
  if (changeCount >= persistenceThreshold) return 'state-drift-sustained';
  if (changeCount > 0) return 'state-drift-observed';
  if (unknownCount > 0) return 'observation-required';
  return 'stable-services';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-service-samples']);
  if (state === 'no-services') return Object.freeze(['no-background-service-review']);
  if (state === 'protect-services') return Object.freeze(['protect-services', 'review-service-owner']);
  if (state === 'state-drift-sustained') return Object.freeze(['review-service-state-drift']);
  if (state === 'state-drift-observed') return Object.freeze(['observe-service-state-stability']);
  if (state === 'observation-required') return Object.freeze(['request-service-state-observation']);
  return Object.freeze(['no-change']);
}

export function runBackgroundStateDriftTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Background-services state-drift samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const changes = evidence.slice(1).map((current, index) => Object.freeze({
    changed: current.signature !== evidence[index].signature,
    runningChanged: current.runningCount !== evidence[index].runningCount,
    stoppedChanged: current.stoppedCount !== evidence[index].stoppedCount,
    failedChanged: current.failedCount !== evidence[index].failedCount
  }));
  const latest = evidence.at(-1);
  const changeCount = changes.filter((item) => item.changed).length;
  const state = stateFor(selected.length, requiredSamples, latest?.serviceCount || 0,
    latest?.criticalFailureCount || 0, latest?.unknownCount || 0, changeCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1, turbo: BACKGROUND_STATE_DRIFT_TURBO_ID,
    turboVersion: BACKGROUND_STATE_DRIFT_TURBO_VERSION, trigger,
    generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length,
    minimumSamples: requiredSamples, persistenceThreshold: requiredPersistence,
    serviceCount: latest?.serviceCount || 0, namedCount: latest?.namedCount || 0,
    runningCount: latest?.runningCount || 0, stoppedCount: latest?.stoppedCount || 0,
    failedCount: latest?.failedCount || 0, unknownCount: latest?.unknownCount || 0,
    criticalFailureCount: latest?.criticalFailureCount || 0, comparisonCount: changes.length,
    changeCount, runningChangeCount: changes.filter((item) => item.runningChanged).length,
    stoppedChangeCount: changes.filter((item) => item.stoppedChanged).length,
    failedChangeCount: changes.filter((item) => item.failedChanged).length,
    finalEnvironment: latest?.environment || 'unknown', state,
    confidence: selected.length === 0 ? 0 : Math.round((latest?.namedCount || 0)
      / Math.max(1, latest?.serviceCount || 0) * 10000) / 10000,
    recommendations: recommendations(state), actions: EMPTY_ARRAY
  });
}
