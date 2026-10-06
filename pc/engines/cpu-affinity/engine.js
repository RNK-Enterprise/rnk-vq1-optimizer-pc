/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * CPU-affinity engine. It evaluates normalized topology and SMT shape so a
 * later approved controller can reason about affinity safely. It never pins
 * processes, changes masks, or opens transport.
 */

export const CPU_AFFINITY_ENGINE_ID = 'cpu-affinity';
export const CPU_AFFINITY_ENGINE_VERSION = 1;
export const CPU_AFFINITY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function boundedPercent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('CPU-affinity facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('CPU-affinity requires system-facts facts');
  if (!isRecord(facts.cpu)) throw new TypeError('CPU-affinity facts require a CPU section');
  return facts;
}

function requireTrigger(trigger) {
  if (!CPU_AFFINITY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-affinity trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('CPU-affinity clock must return a number');
  return timestamp;
}

function topology(physical, logical, sockets) {
  if (physical === null || logical === null) return 'unknown';
  if (physical > logical) return 'inconsistent';
  if (sockets === null) return 'socket-count-unknown';
  if (sockets > 1) return 'multi-socket';
  return physical === logical ? 'single-thread' : 'smt';
}

function risk(topologyName, physical, logical, sockets) {
  if (topologyName === 'unknown' || topologyName === 'inconsistent') return 'review';
  if (topologyName === 'socket-count-unknown') return 'review';
  if (sockets > 1) return 'review';
  if (physical === logical) return 'low';
  if (logical / physical >= 2) return 'smt-layout';
  return 'observe';
}

function workloadProfile(environment, utilization) {
  if (environment === 'unknown') return 'profile-required';
  if (utilization === null) return 'observation-required';
  if (environment === 'headless' && utilization >= 65) return 'throughput';
  if (environment === 'interactive' && utilization >= 65) return 'latency-sensitive';
  return 'balanced';
}

function recommendations(environment, topologyName, riskName, profile) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (profile === 'observation-required') return Object.freeze(['request-cpu-observation']);
  if (topologyName === 'unknown') return Object.freeze(['request-topology-observation']);
  if (topologyName === 'inconsistent') return Object.freeze(['reject-unverified-affinity-change']);
  if (topologyName === 'multi-socket') return Object.freeze(['review-numa-aware-affinity']);
  if (riskName === 'smt-layout') return Object.freeze(['preserve-os-smt-layout']);
  return Object.freeze(['no-change']);
}

function confidence(physical, logical, sockets, utilization) {
  let score = 0;
  if (physical !== null) score += 0.3;
  if (logical !== null) score += 0.3;
  if (sockets !== null) score += 0.2;
  if (utilization !== null) score += 0.2;
  return Math.round(score * 10000) / 10000;
}

export function runCpuAffinityEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const physical = positiveInteger(source.cpu.physicalCpus);
  const logical = positiveInteger(source.cpu.logicalCpus);
  const sockets = positiveInteger(source.cpu.sockets);
  const utilization = boundedPercent(source.cpu.utilizationPercent);
  const topologyName = topology(physical, logical, sockets);
  const riskName = risk(topologyName, physical, logical, sockets);
  const profile = workloadProfile(environment, utilization);
  return Object.freeze({
    protocolVersion: 1,
    engine: CPU_AFFINITY_ENGINE_ID,
    engineVersion: CPU_AFFINITY_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    physicalCpus: physical,
    logicalCpus: logical,
    sockets,
    utilizationPercent: utilization,
    topology: topologyName,
    risk: riskName,
    workloadProfile: profile,
    confidence: confidence(physical, logical, sockets, utilization),
    recommendations: recommendations(environment, topologyName, riskName, profile),
    actions: EMPTY_ARRAY
  });
}
