/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * GPU-policy engine. It classifies vendor, model, driver, and observation
 * evidence without changing GPU policy, drivers, files, or transport state.
 */

export const GPU_POLICY_ENGINE_ID = 'gpu-policy';
export const GPU_POLICY_ENGINE_VERSION = 1;
export const GPU_POLICY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const VENDORS = Object.freeze(['nvidia', 'amd', 'ati', 'intel']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function vendorClass(vendor) {
  const normalized = vendor.toLowerCase();
  if (VENDORS.includes(normalized)) return 'documented';
  if (normalized.includes('nvidia') || normalized.includes('amd') || normalized.includes('ati')
    || normalized.includes('intel')) return 'documented';
  return 'vendor-specific';
}

function driverClass(driver) {
  if (driver.toLowerCase().includes('nouveau') || driver.toLowerCase().includes('amdgpu')
    || driver.toLowerCase().includes('i915') || driver.toLowerCase().includes('nvidia')) {
    return 'documented';
  }
  return 'vendor-specific';
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('GPU-policy facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('GPU-policy requires system-facts facts');
  if (!Array.isArray(facts.gpus)) throw new TypeError('GPU-policy facts require a GPU list');
  return facts;
}

function requireTrigger(trigger) {
  if (!GPU_POLICY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU-policy trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU-policy clock must return a number');
  return timestamp;
}

function operatingState(environment, count, evidence, observation) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-gpu';
  if (observation === false) return 'observation-disabled';
  if (evidence === 'incomplete') return 'observation-required';
  if (evidence === 'vendor-specific') return 'vendor-review';
  return 'observe';
}

function recommendations(environment, state) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (state === 'no-gpu') return Object.freeze(['keep-gpu-controls-disabled']);
  if (state === 'observation-disabled') return Object.freeze(['keep-gpu-observation-disabled']);
  if (state === 'observation-required') return Object.freeze(['request-gpu-policy-observation']);
  if (state === 'vendor-review') return Object.freeze(['review-documented-driver-controls']);
  return Object.freeze(['no-change']);
}

function evidenceFor(gpus) {
  if (gpus.length === 0) return 'none';
  const rows = gpus.map((gpu) => ({
    vendor: text(gpu.vendor),
    model: text(gpu.model),
    driver: text(gpu.driver)
  }));
  if (rows.some((row) => row.vendor === null || row.model === null || row.driver === null)) {
    return 'incomplete';
  }
  if (rows.some((row) => vendorClass(row.vendor) === 'vendor-specific'
    || driverClass(row.driver) === 'vendor-specific')) return 'vendor-specific';
  return 'documented';
}

function confidence(environment, count, evidence, observation) {
  let score = 0;
  if (environment !== 'unknown') score += 0.25;
  if (count > 0) score += 0.25;
  if (evidence === 'documented') score += 0.35;
  else if (evidence === 'vendor-specific') score += 0.2;
  if (observation === true) score += 0.15;
  return Math.round(score * 10000) / 10000;
}

export function runGpuPolicyEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const gpus = source.gpus.filter(isRecord);
  const evidence = evidenceFor(gpus);
  const observation = source.capabilities?.gpuObservation !== false;
  const state = operatingState(environment, gpus.length, evidence, observation);
  return Object.freeze({
    protocolVersion: 1,
    engine: GPU_POLICY_ENGINE_ID,
    engineVersion: GPU_POLICY_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    gpuCount: gpus.length,
    evidence,
    vendors: Object.freeze(gpus.map((gpu) => text(gpu.vendor)).filter(Boolean)),
    models: Object.freeze(gpus.map((gpu) => text(gpu.model)).filter(Boolean)),
    drivers: Object.freeze(gpus.map((gpu) => text(gpu.driver)).filter(Boolean)),
    observationEnabled: observation,
    state,
    confidence: confidence(environment, gpus.length, evidence, observation),
    recommendations: recommendations(environment, state),
    actions: EMPTY_ARRAY
  });
}
