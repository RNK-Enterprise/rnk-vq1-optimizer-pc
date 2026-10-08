/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Background-services criticality-boundary turbo. It reports explicit
 * critical-service evidence without changing service state.
 */

export const BACKGROUND_CRITICALITY_TURBO_ID = 'background-services.criticality-boundary';
export const BACKGROUND_CRITICALITY_TURBO_VERSION = 1;
export const BACKGROUND_CRITICALITY_TRIGGERS = Object.freeze([
  'install.preflight', 'system.facts.request', 'health.interval'
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
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Background-services criticality-boundary snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Background-services criticality-boundary requires a system-facts snapshot');
  if (!Array.isArray(snapshot.services)) throw new TypeError('Background-services criticality-boundary snapshot requires a service list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.services.filter(isRecord).map((service) => ({
    critical: service.critical === true, state: stateOf(service.state), userOwned: service.userOwned === true
  }));
  const critical = rows.filter((row) => row.critical);
  return Object.freeze({
    environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    serviceCount: rows.length, criticalCount: critical.length,
    failedCriticalCount: critical.filter((row) => row.state === 'failed').length,
    unknownCriticalCount: critical.filter((row) => row.state === 'unknown').length,
    userOwnedCriticalCount: critical.filter((row) => row.userOwned).length
  });
}
function requireTrigger(trigger) {
  if (!BACKGROUND_CRITICALITY_TRIGGERS.includes(trigger)) throw new Error(`Unsupported background-services criticality-boundary trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Background-services criticality-boundary windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Background-services criticality-boundary minimumSamples must fit inside the window');
  return value;
}
function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Background-services criticality-boundary clock must return a number');
  return timestamp;
}
function stateFor(sampleCount, minimumSamples, criticalCount, failedCount, unknownCount) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (criticalCount === 0) return 'no-critical-services';
  if (failedCount > 0) return 'protect-critical-services';
  if (unknownCount > 0) return 'critical-observation-required';
  return 'critical-services-observe';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-critical-service-samples']);
  if (state === 'no-critical-services') return Object.freeze(['no-critical-service-review']);
  if (state === 'protect-critical-services') return Object.freeze(['protect-critical-services', 'review-service-owner']);
  if (state === 'critical-observation-required') return Object.freeze(['request-critical-service-state-observation']);
  return Object.freeze(['no-change']);
}
export function runBackgroundCriticalityBoundaryTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Background-services criticality-boundary samples must be an array');
  const boundedWindow = requireWindow(windowSize);
  const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const latest = evidence.at(-1);
  const state = stateFor(selected.length, requiredSamples, latest?.criticalCount || 0,
    latest?.failedCriticalCount || 0, latest?.unknownCriticalCount || 0);
  return Object.freeze({
    protocolVersion: 1, turbo: BACKGROUND_CRITICALITY_TURBO_ID,
    turboVersion: BACKGROUND_CRITICALITY_TURBO_VERSION, trigger,
    generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length,
    minimumSamples: requiredSamples, serviceCount: latest?.serviceCount || 0,
    criticalCount: latest?.criticalCount || 0, failedCriticalCount: latest?.failedCriticalCount || 0,
    unknownCriticalCount: latest?.unknownCriticalCount || 0,
    userOwnedCriticalCount: latest?.userOwnedCriticalCount || 0,
    finalEnvironment: latest?.environment || 'unknown',
    state, confidence: selected.length === 0 ? 0 : Math.round((latest?.criticalCount || 0)
      / Math.max(1, latest?.serviceCount || 0) * 10000) / 10000,
    recommendations: recommendations(state), actions: EMPTY_ARRAY
  });
}
