/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Workload-profile engine. It classifies declared workload context without
 * changing processes, application settings, files, or transport state.
 */

export const WORKLOAD_PROFILE_ENGINE_ID = 'workload-profile';
export const WORKLOAD_PROFILE_ENGINE_VERSION = 1;
export const WORKLOAD_PROFILE_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const WORKLOADS = Object.freeze(['gaming', 'creative', 'development', 'server', 'idle']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function workloadOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
  const normalized = value.trim().toLowerCase();
  return WORKLOADS.includes(normalized) ? normalized : 'unknown';
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Workload-profile facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Workload-profile requires system-facts facts');
  if (!isRecord(facts.workload)) throw new TypeError('Workload-profile facts require a workload object');
  return facts;
}

function requireTrigger(trigger) {
  if (!WORKLOAD_PROFILE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported workload-profile trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Workload-profile clock must return a number');
  return timestamp;
}

function operatingState(environment, workload, declared) {
  if (environment === 'unknown') return 'profile-required';
  if (declared === false) return 'workload-required';
  if (workload === 'unknown') return 'observation-required';
  if (workload === 'server' || environment === 'headless') return 'service-profile';
  return 'interactive-profile';
}

function recommendations(environment, workload, declared) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (declared === false) return Object.freeze(['request-workload-profile']);
  if (workload === 'unknown') return Object.freeze(['request-documented-workload-kind']);
  if (workload === 'server' || environment === 'headless') return Object.freeze(['preserve-service-workload']);
  return Object.freeze(['preserve-user-owned-workload']);
}

function confidence(environment, workload, name, declared) {
  let score = 0;
  if (environment !== 'unknown') score += 0.25;
  if (workload !== 'unknown') score += 0.5;
  if (name !== null) score += 0.15;
  if (declared !== null) score += 0.1;
  return Math.round(score * 10000) / 10000;
}

export function runWorkloadProfileEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const workload = source.workload;
  const kind = workloadOf(workload.kind);
  const name = text(workload.name);
  const declared = typeof workload.declared === 'boolean' ? workload.declared : null;
  const interactive = typeof workload.interactive === 'boolean' ? workload.interactive : null;
  return Object.freeze({
    protocolVersion: 1,
    engine: WORKLOAD_PROFILE_ENGINE_ID,
    engineVersion: WORKLOAD_PROFILE_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    workloadKind: kind,
    workloadName: name,
    declared,
    interactive,
    state: operatingState(environment, kind, declared),
    confidence: confidence(environment, kind, name, declared),
    recommendations: recommendations(environment, kind, declared),
    actions: EMPTY_ARRAY
  });
}
