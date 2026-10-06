/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * GPU-utilization engine. It aggregates bounded GPU observations and reports
 * thermal/utilization pressure without changing GPU policy, drivers, files,
 * or transport state.
 */

export const GPU_UTILIZATION_ENGINE_ID = 'gpu-utilization';
export const GPU_UTILIZATION_ENGINE_VERSION = 1;
export const GPU_UTILIZATION_TRIGGERS = Object.freeze([
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

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('GPU-utilization facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('GPU-utilization requires system-facts facts');
  if (!Array.isArray(facts.gpus)) throw new TypeError('GPU-utilization facts require a GPU list');
  return facts;
}

function requireTrigger(trigger) {
  if (!GPU_UTILIZATION_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU-utilization trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU-utilization clock must return a number');
  return timestamp;
}

function maximum(gpus, selector) {
  const values = gpus.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

function levelFor(utilization, temperature) {
  if (utilization === null && temperature === null) return 'unknown';
  if ((utilization !== null && utilization >= 90) || (temperature !== null && temperature >= 85)) return 'high';
  if ((utilization !== null && utilization >= 70) || (temperature !== null && temperature >= 75)) return 'elevated';
  return 'normal';
}

function operatingState(environment, level, count) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-gpu';
  if (level === 'unknown') return 'observation-required';
  if (level === 'high' && environment === 'headless') return 'protect-services';
  if (level === 'high') return 'protect-foreground';
  if (level === 'elevated') return 'watch';
  return 'observe';
}

function recommendations(environment, level, count) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-change', 'keep-gpu-controls-disabled']);
  if (level === 'unknown') return Object.freeze(['request-gpu-observation']);
  if (level === 'high' && environment === 'headless') {
    return Object.freeze(['protect-services', 'hold-unapproved-gpu-policy']);
  }
  if (level === 'high') return Object.freeze(['protect-foreground', 'hold-unapproved-gpu-policy']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample', 'review-thermal-headroom']);
  return Object.freeze(['no-change']);
}

function confidence(environment, count, utilization, temperature) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (count > 0) score += 0.2;
  if (utilization !== null) score += 0.3;
  if (temperature !== null) score += 0.3;
  return Math.round(score * 10000) / 10000;
}

export function runGpuUtilizationEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const gpus = source.gpus.filter(isRecord);
  const utilization = maximum(gpus, (gpu) => percent(gpu.utilizationPercent));
  const temperature = maximum(gpus, (gpu) => percent(gpu.temperatureCelsius));
  const vramBytes = maximum(gpus, (gpu) => nonNegative(gpu.vramBytes));
  const level = gpus.length === 0 ? 'none' : levelFor(utilization, temperature);
  return Object.freeze({
    protocolVersion: 1,
    engine: GPU_UTILIZATION_ENGINE_ID,
    engineVersion: GPU_UTILIZATION_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    gpuCount: gpus.length,
    models: Object.freeze(gpus.map((gpu) => text(gpu.model)).filter(Boolean)),
    utilizationPercent: utilization,
    temperatureCelsius: temperature,
    maximumVramBytes: vramBytes,
    level,
    state: operatingState(environment, level, gpus.length),
    confidence: confidence(environment, gpus.length, utilization, temperature),
    recommendations: recommendations(environment, level, gpus.length),
    actions: EMPTY_ARRAY
  });
}
