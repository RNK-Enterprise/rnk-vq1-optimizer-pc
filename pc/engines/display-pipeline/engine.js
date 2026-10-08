/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Display-pipeline engine. It classifies display facts without changing
 * resolution, refresh, HDR, VRR, files, or transport state.
 */

export const DISPLAY_PIPELINE_ENGINE_ID = 'display-pipeline';
export const DISPLAY_PIPELINE_ENGINE_VERSION = 1;
export const DISPLAY_PIPELINE_TRIGGERS = Object.freeze([
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

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Display-pipeline facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Display-pipeline requires system-facts facts');
  return facts;
}

function requireTrigger(trigger) {
  if (!DISPLAY_PIPELINE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported display-pipeline trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Display-pipeline clock must return a number');
  return timestamp;
}

function pipelineState(environment, present, observation, refreshRate, width, height) {
  if (environment === 'unknown') return 'profile-required';
  if (environment === 'headless' || present === false) return 'no-display';
  if (observation === false) return 'observation-disabled';
  if (present === null || refreshRate === null || width === null || height === null) {
    return 'observation-required';
  }
  return 'observe';
}

function recommendations(environment, present, observation, state) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (environment === 'headless' || present === false) {
    return Object.freeze(['keep-display-controls-disabled']);
  }
  if (observation === false) return Object.freeze(['keep-display-observation-disabled']);
  if (state === 'observation-required') return Object.freeze(['request-display-pipeline-observation']);
  return Object.freeze(['no-change']);
}

function confidence(environment, present, refreshRate, width, height) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (present !== null) score += 0.2;
  if (refreshRate !== null) score += 0.2;
  if (width !== null) score += 0.2;
  if (height !== null) score += 0.2;
  return Math.round(score * 10000) / 10000;
}

export function runDisplayPipelineEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const present = booleanOrNull(source.displayPresent);
  const refreshRate = positive(source.refreshRateHz);
  const width = positiveInteger(source.resolutionWidth);
  const height = positiveInteger(source.resolutionHeight);
  const hdr = booleanOrNull(source.hdr);
  const vrr = booleanOrNull(source.vrr);
  const observation = source.capabilities?.displayObservation !== false;
  const state = pipelineState(environment, present, observation, refreshRate, width, height);
  return Object.freeze({
    protocolVersion: 1,
    engine: DISPLAY_PIPELINE_ENGINE_ID,
    engineVersion: DISPLAY_PIPELINE_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    displayPresent: present,
    refreshRateHz: refreshRate,
    resolutionWidth: width,
    resolutionHeight: height,
    pixelCount: width === null || height === null ? null : width * height,
    hdr,
    vrr,
    observationEnabled: observation,
    state,
    confidence: confidence(environment, present, refreshRate, width, height),
    recommendations: recommendations(environment, present, observation, state),
    actions: EMPTY_ARRAY
  });
}
