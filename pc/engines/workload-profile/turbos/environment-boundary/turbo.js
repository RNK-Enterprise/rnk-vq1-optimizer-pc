/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Workload-profile environment-boundary turbo. It tracks declared interactive
 * or headless context without changing services, sessions, or boot state.
 */
export const WORKLOAD_ENVIRONMENT_BOUNDARY_TURBO_ID = 'workload-profile.environment-boundary';
export const WORKLOAD_ENVIRONMENT_BOUNDARY_TURBO_VERSION = 1;
export const WORKLOAD_ENVIRONMENT_BOUNDARY_TRIGGERS = Object.freeze(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Workload-profile environment-boundary snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Workload-profile environment-boundary requires a system-facts snapshot');
  return snapshot;
}
function evidenceOf(snapshot) { const source = requireSnapshot(snapshot); const environment = environmentOf(source.environment); return Object.freeze({ environment, observed: environment !== 'unknown' }); }
function requireTrigger(trigger) { if (!WORKLOAD_ENVIRONMENT_BOUNDARY_TRIGGERS.includes(trigger)) throw new Error(`Unsupported workload-profile environment-boundary trigger: ${trigger || 'unknown'}`); return trigger; }
function requireWindow(value) { if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Workload-profile environment-boundary windowSize must be an integer from 2 to 64'); return value; }
function requireMinimum(value, windowSize) { if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Workload-profile environment-boundary minimumSamples must fit inside the window'); return value; }
function requireThreshold(value, windowSize) { if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Workload-profile environment-boundary persistenceThreshold must fit inside the window'); return value; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workload-profile environment-boundary clock must return a number'); return timestamp; }
function stateFor(sampleCount, minimumSamples, observedCount, unknownCount, changeCount, persistenceThreshold, finalEnvironment) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'profile-required';
  if (unknownCount > 0) return 'observation-required';
  if (changeCount >= persistenceThreshold) return 'environment-drift-sustained';
  if (changeCount > 0) return 'environment-drift-observed';
  if (finalEnvironment === 'headless') return 'headless-boundary';
  return 'interactive-boundary';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-environment-samples']);
  if (state === 'profile-required') return Object.freeze(['request-environment-profile']);
  if (state === 'observation-required') return Object.freeze(['request-complete-environment-observation']);
  if (state === 'environment-drift-sustained') return Object.freeze(['review-environment-boundary-drift']);
  if (state === 'environment-drift-observed') return Object.freeze(['observe-environment-boundary-stability']);
  if (state === 'headless-boundary') return Object.freeze(['preserve-headless-boundary']);
  return Object.freeze(['preserve-interactive-boundary']);
}
export function runWorkloadEnvironmentBoundaryTurbo(samples = [], { trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now } = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Workload-profile environment-boundary samples must be an array');
  const boundedWindow = requireWindow(windowSize); const requiredSamples = requireMinimum(minimumSamples, boundedWindow); const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow);
  const selected = samples.slice(-boundedWindow); const timestamp = requireClock(now); const evidence = selected.map(evidenceOf);
  const changes = evidence.slice(1).map((current, index) => Object.freeze({ changed: current.environment !== evidence[index].environment }));
  const observedCount = evidence.filter((item) => item.observed).length; const unknownCount = evidence.length - observedCount; const changeCount = changes.filter((item) => item.changed).length;
  const latest = evidence.length === 0 ? null : evidence[evidence.length - 1]; const finalEnvironment = latest ? latest.environment : 'unknown';
  const state = stateFor(selected.length, requiredSamples, observedCount, unknownCount, changeCount, requiredPersistence, finalEnvironment);
  return Object.freeze({ protocolVersion: 1, turbo: WORKLOAD_ENVIRONMENT_BOUNDARY_TURBO_ID, turboVersion: WORKLOAD_ENVIRONMENT_BOUNDARY_TURBO_VERSION, trigger,
    generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples, persistenceThreshold: requiredPersistence,
    observedCount, unknownCount, comparisonCount: changes.length, changeCount, finalEnvironment, state,
    confidence: selected.length === 0 ? 0 : Math.round((observedCount / selected.length) * 10000) / 10000, recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
