/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Background-services observation-boundary turbo. It reports explicit
 * observation capability without enabling or disabling service observation.
 */

export const BACKGROUND_OBSERVATION_TURBO_ID = 'background-services.observation-boundary';
export const BACKGROUND_OBSERVATION_TURBO_VERSION = 1;
export const BACKGROUND_OBSERVATION_TRIGGERS = Object.freeze([
  'install.preflight', 'system.facts.request', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function observationOf(capabilities) {
  if (!isRecord(capabilities) || typeof capabilities.backgroundServiceObservation !== 'boolean') return 'unknown';
  return capabilities.backgroundServiceObservation ? 'enabled' : 'disabled';
}
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Background-services observation-boundary snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Background-services observation-boundary requires a system-facts snapshot');
  if (!Array.isArray(snapshot.services)) throw new TypeError('Background-services observation-boundary snapshot requires a service list');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  return Object.freeze({
    environment: ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown',
    serviceCount: source.services.filter(isRecord).length,
    observation: observationOf(source.capabilities)
  });
}
function requireTrigger(trigger) {
  if (!BACKGROUND_OBSERVATION_TRIGGERS.includes(trigger)) throw new Error(`Unsupported background-services observation-boundary trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Background-services observation-boundary windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Background-services observation-boundary minimumSamples must fit inside the window');
  return value;
}
function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Background-services observation-boundary clock must return a number');
  return timestamp;
}
function stateFor(sampleCount, minimumSamples, serviceCount, observation) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (serviceCount === 0) return 'no-services';
  if (observation === 'disabled') return 'observation-disabled';
  if (observation === 'unknown') return 'observation-capability-unknown';
  return 'observation-enabled';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-observation-samples']);
  if (state === 'no-services') return Object.freeze(['no-background-service-review']);
  if (state === 'observation-disabled') return Object.freeze(['keep-service-observation-disabled']);
  if (state === 'observation-capability-unknown') return Object.freeze(['request-observation-capability']);
  return Object.freeze(['no-change']);
}
export function runBackgroundObservationBoundaryTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Background-services observation-boundary samples must be an array');
  const boundedWindow = requireWindow(windowSize);
  const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const latest = evidence.at(-1);
  const state = stateFor(selected.length, requiredSamples, latest?.serviceCount || 0, latest?.observation || 'unknown');
  return Object.freeze({
    protocolVersion: 1, turbo: BACKGROUND_OBSERVATION_TURBO_ID, turboVersion: BACKGROUND_OBSERVATION_TURBO_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length,
    minimumSamples: requiredSamples, serviceCount: latest?.serviceCount || 0,
    observation: latest?.observation || 'unknown', finalEnvironment: latest?.environment || 'unknown',
    state, confidence: selected.length === 0 ? 0 : latest?.observation === 'unknown' ? 0 : 1,
    recommendations: recommendations(state), actions: EMPTY_ARRAY
  });
}
