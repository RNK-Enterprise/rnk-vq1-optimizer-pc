/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-affinity library. It normalizes explicit CPU-list evidence and compares
 * snapshots without applying masks or pinning processes.
 */

export const CPU_AFFINITY_LIBRARY_ID = 'cpu-affinity-library';
export const CPU_AFFINITY_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function cpuList(value) {
  if (!Array.isArray(value)) return null;
  return Object.freeze(value.filter((item) => nonNegativeInteger(item) !== null)
    .filter((item, index, list) => list.indexOf(item) === index)
    .sort((left, right) => left - right));
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('CPU-affinity library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('CPU-affinity library requires normalized system facts');
  }
  if (!ENVIRONMENTS.includes(facts.environment) || !isRecord(facts.cpu)) {
    throw new TypeError('CPU-affinity library requires CPU facts');
  }
  return facts;
}

function stateFor(logicalCpus, affinity, isolated) {
  if (logicalCpus === null) return 'unknown';
  if (affinity === null && isolated === null) return 'default';
  if ((affinity !== null && affinity.length === 0) || (isolated !== null && isolated.length === 0)) {
    return 'explicit-empty';
  }
  return 'explicit';
}

function recommendations(state, environment) {
  if (state === 'unknown') return Object.freeze(['request-cpu-topology-observation']);
  if (state === 'default') return Object.freeze(['preserve-default-affinity']);
  if (state === 'explicit-empty') return Object.freeze(['review-empty-affinity-list']);
  if (environment === 'headless') return Object.freeze(['preserve-service-affinity']);
  return Object.freeze(['review-user-owned-affinity']);
}

export function classifyCpuAffinity(facts) {
  const source = requireFacts(facts);
  const logicalCpus = nonNegativeInteger(source.cpu.logicalCpus);
  const physicalCpus = nonNegativeInteger(source.cpu.physicalCpus);
  const affinity = cpuList(source.cpu.affinityCpus);
  const isolated = cpuList(source.cpu.isolatedCpus);
  const state = stateFor(logicalCpus, affinity, isolated);
  return Object.freeze({
    library: CPU_AFFINITY_LIBRARY_ID,
    libraryVersion: CPU_AFFINITY_LIBRARY_VERSION,
    environment: source.environment,
    logicalCpus,
    physicalCpus,
    affinityCpus: affinity,
    isolatedCpus: isolated,
    affinityCount: affinity === null ? null : affinity.length,
    isolatedCount: isolated === null ? null : isolated.length,
    state,
    recommendations: recommendations(state, source.environment)
  });
}

function sameList(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function compareCpuAffinity(previous, current) {
  const before = classifyCpuAffinity(previous);
  const after = classifyCpuAffinity(current);
  return Object.freeze({
    changed: before.logicalCpus !== after.logicalCpus
      || !sameList(before.affinityCpus, after.affinityCpus)
      || !sameList(before.isolatedCpus, after.isolatedCpus),
    affinityChanged: !sameList(before.affinityCpus, after.affinityCpus),
    isolatedChanged: !sameList(before.isolatedCpus, after.isolatedCpus),
    previousState: before.state,
    currentState: after.state
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('CPU-affinity library clock must return a number');
  return timestamp;
}

export function buildCpuAffinityEnvelope(facts, {
  trigger,
  now = Date.now
} = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('CPU-affinity library trigger is required');
  }
  return Object.freeze({
    library: CPU_AFFINITY_LIBRARY_ID,
    libraryVersion: CPU_AFFINITY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyCpuAffinity(facts)
  });
}

export function createCpuAffinityLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('CPU-affinity library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: CPU_AFFINITY_LIBRARY_ID,
    version: CPU_AFFINITY_LIBRARY_VERSION,
    classify: classifyCpuAffinity,
    compare: compareCpuAffinity,
    envelope: (facts, envelopeOptions = {}) => buildCpuAffinityEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    }),
    emptyRecommendations: EMPTY_ARRAY
  });
}
