/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * CPU-scheduler engine. It classifies the observed workload and governor
 * alignment without changing scheduler policy, frequency, affinity, files,
 * or transport state.
 */

export const CPU_SCHEDULER_ENGINE_ID = 'cpu-scheduler';
export const CPU_SCHEDULER_ENGINE_VERSION = 1;
export const CPU_SCHEDULER_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const GOVERNORS = Object.freeze(['performance', 'powersave', 'schedutil']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('CPU-scheduler facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('CPU-scheduler requires system-facts facts');
  if (!isRecord(facts.cpu)) throw new TypeError('CPU-scheduler facts require a CPU section');
  return facts;
}

function requireTrigger(trigger) {
  if (!CPU_SCHEDULER_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-scheduler trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('CPU-scheduler clock must return a number');
  return timestamp;
}

function workloadLevel(utilization) {
  if (utilization === null) return 'unknown';
  if (utilization >= 85) return 'saturated';
  if (utilization >= 65) return 'busy';
  return 'normal';
}

function schedulerProfile(environment, workload) {
  if (environment === 'unknown') return 'profile-required';
  if (workload === 'unknown') return 'observation-required';
  if (environment === 'interactive' && workload !== 'normal') return 'latency-sensitive';
  if (environment === 'headless' && workload !== 'normal') return 'throughput';
  return 'balanced';
}

function governorState(profile, governor) {
  if (profile === 'profile-required') return 'profile-required';
  if (profile === 'observation-required' || governor === null) return 'unknown';
  if (profile === 'balanced') return governor === 'schedutil' ? 'aligned' : 'acceptable';
  if (governor === 'performance' || governor === 'schedutil') return 'aligned';
  return 'review';
}

function recommendations(profile, state) {
  if (profile === 'profile-required') return Object.freeze(['request-environment-profile']);
  if (profile === 'observation-required' || state === 'unknown') {
    return Object.freeze(['request-cpu-scheduler-observation']);
  }
  if (state === 'review') return Object.freeze(['review-documented-governor-control']);
  return Object.freeze(['no-change']);
}

function confidence(environment, utilization, governor, driver) {
  let score = 0;
  if (environment !== 'unknown') score += 0.35;
  if (utilization !== null) score += 0.35;
  if (governor !== null) score += 0.2;
  if (driver !== null) score += 0.1;
  return Math.round(score * 10000) / 10000;
}

export function runCpuSchedulerEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const utilization = percent(source.cpu.utilizationPercent);
  const workload = workloadLevel(utilization);
  const profile = schedulerProfile(environment, workload);
  const governor = text(source.cpu.governor);
  const driver = text(source.cpu.driver);
  const normalizedGovernor = GOVERNORS.includes(governor) ? governor : null;
  const state = governorState(profile, normalizedGovernor);
  return Object.freeze({
    protocolVersion: 1,
    engine: CPU_SCHEDULER_ENGINE_ID,
    engineVersion: CPU_SCHEDULER_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    utilizationPercent: utilization,
    workload,
    profile,
    governor: normalizedGovernor,
    driver,
    alignment: state,
    confidence: confidence(environment, utilization, normalizedGovernor, driver),
    recommendations: recommendations(profile, state),
    actions: EMPTY_ARRAY
  });
}
