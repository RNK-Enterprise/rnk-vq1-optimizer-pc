/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-utilization engine. It classifies normalized CPU observations and
 * produces bounded workload guidance. It never changes scheduling, frequency,
 * affinity, files, or transport state.
 */

export const CPU_UTILIZATION_ENGINE_ID = 'cpu-utilization';
export const CPU_UTILIZATION_ENGINE_VERSION = 1;
export const CPU_UTILIZATION_TRIGGERS = Object.freeze([
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

function clamp(value, lower = 0, upper = 100) {
  return Math.min(upper, Math.max(lower, value));
}

function percent(value) {
  return Number.isFinite(value) ? clamp(value) : null;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('CPU-utilization facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('CPU-utilization requires system-facts facts');
  if (!isRecord(facts.cpu)) throw new TypeError('CPU-utilization facts require a CPU section');
  return facts;
}

function requireTrigger(trigger) {
  if (!CPU_UTILIZATION_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-utilization trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('CPU-utilization clock must return a number');
  return timestamp;
}

function classify(utilization) {
  if (utilization === null) return 'unknown';
  if (utilization < 25) return 'idle';
  if (utilization < 65) return 'balanced';
  if (utilization < 85) return 'busy';
  return 'saturated';
}

function operatingState(environment, level) {
  if (environment === 'unknown') return 'profile-required';
  if (level === 'saturated' && environment === 'headless') return 'protect-services';
  if (level === 'saturated') return 'protect-foreground';
  if (level === 'busy') return 'contention-watch';
  return 'observe';
}

function recommendations(environment, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (level === 'unknown') return Object.freeze(['request-cpu-observation']);
  if (level === 'saturated' && environment === 'headless') {
    return Object.freeze(['protect-services', 'hold-destructive-actions']);
  }
  if (level === 'saturated') {
    return Object.freeze(['protect-foreground', 'hold-destructive-actions']);
  }
  if (level === 'busy') return Object.freeze(['observe-next-sample', 'avoid-unapproved-affinity-changes']);
  return Object.freeze(['no-change']);
}

function confidence(facts, utilization, logicalCpus, model) {
  let score = 0;
  if (utilization !== null) score += 0.6;
  if (logicalCpus !== null) score += 0.25;
  if (model !== null) score += 0.15;
  return Math.round(score * 10000) / 10000;
}

export function runCpuUtilizationEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const utilization = percent(source.cpu.utilizationPercent);
  const level = classify(utilization);
  const logicalCpus = positiveInteger(source.cpu.logicalCpus);
  const model = text(source.cpu.model);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  return Object.freeze({
    protocolVersion: 1,
    engine: CPU_UTILIZATION_ENGINE_ID,
    engineVersion: CPU_UTILIZATION_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    utilizationPercent: utilization,
    headroomPercent: utilization === null ? null : Math.round((100 - utilization) * 100) / 100,
    logicalCpus,
    model,
    level,
    state: operatingState(environment, level),
    confidence: confidence(source, utilization, logicalCpus, model),
    recommendations: recommendations(environment, level),
    actions: EMPTY_ARRAY
  });
}
