/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Workload-profile library. It classifies declared workload context without
 * changing processes, application settings, files, or transport state.
 */

export const WORKLOAD_PROFILE_LIBRARY_ID = 'workload-profile-library';
export const WORKLOAD_PROFILE_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const WORKLOADS = Object.freeze(['gaming', 'creative', 'development', 'server', 'idle']);

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
  if (!isRecord(facts)) throw new TypeError('Workload-profile library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Workload-profile library requires normalized system facts');
  }
  if (!isRecord(facts.workload)) {
    throw new TypeError('Workload-profile library requires a workload object');
  }
  return facts;
}

function stateFor(environment, workload, declared) {
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

export function classifyWorkloadProfile(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const workload = source.workload;
  const kind = workloadOf(workload.kind);
  const name = text(workload.name);
  const declared = typeof workload.declared === 'boolean' ? workload.declared : null;
  const interactive = typeof workload.interactive === 'boolean' ? workload.interactive : null;
  return Object.freeze({
    library: WORKLOAD_PROFILE_LIBRARY_ID,
    libraryVersion: WORKLOAD_PROFILE_LIBRARY_VERSION,
    environment,
    workloadKind: kind,
    workloadName: name,
    declared,
    interactive,
    state: stateFor(environment, kind, declared),
    confidence: confidence(environment, kind, name, declared),
    recommendations: recommendations(environment, kind, declared)
  });
}

export function compareWorkloadProfile(previous, current) {
  const before = classifyWorkloadProfile(previous);
  const after = classifyWorkloadProfile(current);
  const stateChanged = before.state !== after.state;
  const kindChanged = before.workloadKind !== after.workloadKind;
  const nameChanged = before.workloadName !== after.workloadName;
  const declaredChanged = before.declared !== after.declared;
  const interactiveChanged = before.interactive !== after.interactive;
  return Object.freeze({
    changed: stateChanged || kindChanged || nameChanged || declaredChanged || interactiveChanged,
    stateChanged,
    kindChanged,
    nameChanged,
    declaredChanged,
    interactiveChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Workload-profile library clock must return a number');
  return timestamp;
}

export function buildWorkloadProfileEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Workload-profile library trigger is required');
  }
  return Object.freeze({
    library: WORKLOAD_PROFILE_LIBRARY_ID,
    libraryVersion: WORKLOAD_PROFILE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyWorkloadProfile(facts)
  });
}

export function createWorkloadProfileLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Workload-profile library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: WORKLOAD_PROFILE_LIBRARY_ID,
    version: WORKLOAD_PROFILE_LIBRARY_VERSION,
    classify: classifyWorkloadProfile,
    compare: compareWorkloadProfile,
    envelope: (facts, envelopeOptions = {}) => buildWorkloadProfileEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
