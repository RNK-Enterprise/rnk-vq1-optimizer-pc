/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * CPU-frequency engine. It classifies observed governor and driver evidence
 * without changing frequency policy, writing files, or opening transport.
 */

export const CPU_FREQUENCY_ENGINE_ID = 'cpu-frequency';
export const CPU_FREQUENCY_ENGINE_VERSION = 1;
export const CPU_FREQUENCY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const GOVERNORS = Object.freeze(['performance', 'powersave', 'schedutil']);
const DRIVERS = Object.freeze(['intel_pstate', 'amd_pstate', 'acpi-cpufreq']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('CPU-frequency facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('CPU-frequency requires system-facts facts');
  if (!isRecord(facts.cpu)) throw new TypeError('CPU-frequency facts require a CPU section');
  return facts;
}

function requireTrigger(trigger) {
  if (!CPU_FREQUENCY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-frequency trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('CPU-frequency clock must return a number');
  return timestamp;
}

function governorClass(governor) {
  if (governor === null) return 'unknown';
  if (governor === 'schedutil') return 'adaptive';
  if (governor === 'performance') return 'fixed-high';
  if (governor === 'powersave') return 'fixed-low';
  return 'vendor-specific';
}

function driverClass(driver) {
  if (driver === null) return 'unknown';
  if (DRIVERS.includes(driver)) return 'documented';
  return 'vendor-specific';
}

function policyState(environment, driver, governor, utilization) {
  if (environment === 'unknown') return 'profile-required';
  if (driver === null) return 'driver-observation-required';
  if (governor === null) return 'governor-observation-required';
  if (utilization === null) return 'workload-observation-required';
  if (environment === 'interactive' && governor === 'schedutil') return 'preserve-adaptive-policy';
  if (environment === 'headless' && utilization >= 85 && governor === 'performance') {
    return 'review-throughput-policy';
  }
  return 'observe';
}

function recommendations(state) {
  if (state === 'profile-required') return Object.freeze(['request-environment-profile']);
  if (state === 'driver-observation-required') return Object.freeze(['request-cpu-driver-observation']);
  if (state === 'governor-observation-required') return Object.freeze(['request-cpu-governor-observation']);
  if (state === 'workload-observation-required') return Object.freeze(['request-cpu-observation']);
  if (state === 'review-throughput-policy') {
    return Object.freeze(['review-documented-frequency-control', 'hold-unapproved-policy-change']);
  }
  if (state === 'preserve-adaptive-policy') return Object.freeze(['preserve-adaptive-policy']);
  return Object.freeze(['no-change']);
}

function confidence(environment, driver, governor, utilization) {
  let score = 0;
  if (environment !== 'unknown') score += 0.25;
  if (driver !== null) score += 0.25;
  if (governor !== null) score += 0.25;
  if (utilization !== null) score += 0.25;
  return score;
}

export function runCpuFrequencyEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const observedGovernor = text(source.cpu.governor);
  const observedDriver = text(source.cpu.driver);
  const utilization = percent(source.cpu.utilizationPercent);
  const normalizedGovernor = GOVERNORS.includes(observedGovernor) ? observedGovernor : null;
  const normalizedDriver = DRIVERS.includes(observedDriver) ? observedDriver : null;
  const state = policyState(environment, normalizedDriver, normalizedGovernor, utilization);
  return Object.freeze({
    protocolVersion: 1,
    engine: CPU_FREQUENCY_ENGINE_ID,
    engineVersion: CPU_FREQUENCY_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    governor: observedGovernor,
    governorClass: governorClass(observedGovernor),
    driver: observedDriver,
    driverClass: driverClass(observedDriver),
    utilizationPercent: utilization,
    state,
    confidence: confidence(environment, normalizedDriver, normalizedGovernor, utilization),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
