/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Workload-profile context-drift turbo. It compares declared workload context
 * and reports movement without changing process, application, or user state.
 */

export const WORKLOAD_CONTEXT_DRIFT_TURBO_ID = 'workload-profile.context-drift';
export const WORKLOAD_CONTEXT_DRIFT_TURBO_VERSION = 1;
export const WORKLOAD_CONTEXT_DRIFT_TRIGGERS = Object.freeze([
  'system.facts.request', 'workload.changed', 'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const WORKLOADS = Object.freeze(['gaming', 'creative', 'development', 'server', 'idle']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null; }
function kindOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
  const normalized = value.trim().toLowerCase();
  return WORKLOADS.includes(normalized) ? normalized : 'unknown';
}
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Workload-profile context-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Workload-profile context-drift requires a system-facts snapshot');
  if (!isRecord(snapshot.workload)) throw new TypeError('Workload-profile context-drift snapshot requires a workload object');
  return snapshot;
}
function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const workload = source.workload;
  const kind = kindOf(workload.kind);
  const name = text(workload.name);
  const declared = typeof workload.declared === 'boolean' ? workload.declared : null;
  const observed = environment !== 'unknown' && kind !== 'unknown';
  return Object.freeze({ environment, kind, name, declared, observed,
    signature: `${environment}:${kind}:${name || '?'}:${declared === null ? '?' : declared}` });
}
function requireTrigger(trigger) {
  if (!WORKLOAD_CONTEXT_DRIFT_TRIGGERS.includes(trigger)) throw new Error(`Unsupported workload-profile context-drift trigger: ${trigger || 'unknown'}`);
  return trigger;
}
function requireWindow(value) {
  if (!Number.isInteger(value) || value < 2 || value > 64) throw new RangeError('Workload-profile context-drift windowSize must be an integer from 2 to 64');
  return value;
}
function requireMinimum(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Workload-profile context-drift minimumSamples must fit inside the window');
  return value;
}
function requireThreshold(value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Workload-profile context-drift persistenceThreshold must fit inside the window');
  return value;
}
function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Workload-profile context-drift clock must return a number');
  return timestamp;
}
function stateFor(sampleCount, minimumSamples, observedCount, unknownCount, changeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'profile-required';
  if (unknownCount > 0) return 'observation-required';
  if (changeCount >= persistenceThreshold) return 'context-drift-sustained';
  if (changeCount > 0) return 'context-drift-observed';
  return 'stable-context';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-workload-context']);
  if (state === 'profile-required') return Object.freeze(['request-workload-context-profile']);
  if (state === 'context-drift-sustained') return Object.freeze(['review-workload-context-drift']);
  if (state === 'context-drift-observed') return Object.freeze(['observe-workload-context-stability']);
  if (state === 'observation-required') return Object.freeze(['request-complete-workload-context']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}

export function runWorkloadContextDriftTurbo(samples = [], {
  trigger, windowSize = 16, minimumSamples = 2, persistenceThreshold = 2, now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Workload-profile context-drift samples must be an array');
  const boundedWindow = requireWindow(windowSize);
  const requiredSamples = requireMinimum(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold(persistenceThreshold, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const changes = evidence.slice(1).map((current, index) => Object.freeze({
    changed: current.signature !== evidence[index].signature,
    environmentChanged: current.environment !== evidence[index].environment,
    kindChanged: current.kind !== evidence[index].kind
  }));
  const observedCount = evidence.filter((item) => item.observed).length;
  const unknownCount = evidence.length - observedCount;
  const changeCount = changes.filter((item) => item.changed).length;
  const state = stateFor(selected.length, requiredSamples, observedCount, unknownCount, changeCount, requiredPersistence);
  const latest = evidence.length === 0 ? null : evidence[evidence.length - 1];
  return Object.freeze({
    protocolVersion: 1, turbo: WORKLOAD_CONTEXT_DRIFT_TURBO_ID,
    turboVersion: WORKLOAD_CONTEXT_DRIFT_TURBO_VERSION, trigger,
    generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length,
    minimumSamples: requiredSamples, persistenceThreshold: requiredPersistence,
    observedCount, unknownCount, comparisonCount: changes.length, changeCount,
    environmentChangeCount: changes.filter((item) => item.environmentChanged).length,
    kindChangeCount: changes.filter((item) => item.kindChanged).length,
    finalEnvironment: latest ? latest.environment : 'unknown', finalWorkloadKind: latest ? latest.kind : 'unknown',
    finalWorkloadName: latest ? latest.name : null, state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state), actions: EMPTY_ARRAY
  });
}
