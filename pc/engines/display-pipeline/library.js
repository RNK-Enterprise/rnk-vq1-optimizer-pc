/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Display-pipeline library. It classifies display evidence for review and
 * never changes resolution, refresh, HDR, VRR, files, or transport.
 */

export const DISPLAY_PIPELINE_LIBRARY_ID = 'display-pipeline-library';
export const DISPLAY_PIPELINE_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

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
  if (!isRecord(facts)) throw new TypeError('Display-pipeline library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Display-pipeline library requires normalized system facts');
  }
  return facts;
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

export function classifyDisplayPipeline(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const present = booleanOrNull(source.displayPresent);
  const refreshRate = positive(source.refreshRateHz);
  const width = positiveInteger(source.resolutionWidth);
  const height = positiveInteger(source.resolutionHeight);
  const hdr = booleanOrNull(source.hdr);
  const vrr = booleanOrNull(source.vrr);
  const observation = !(isRecord(source.capabilities) && source.capabilities.displayObservation === false);
  const state = pipelineState(environment, present, observation, refreshRate, width, height);
  return Object.freeze({
    library: DISPLAY_PIPELINE_LIBRARY_ID,
    libraryVersion: DISPLAY_PIPELINE_LIBRARY_VERSION,
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
    recommendations: recommendations(environment, present, observation, state)
  });
}

export function compareDisplayPipeline(previous, current) {
  const before = classifyDisplayPipeline(previous);
  const after = classifyDisplayPipeline(current);
  const stateChanged = before.state !== after.state;
  const refreshChanged = before.refreshRateHz !== after.refreshRateHz;
  const resolutionChanged = before.pixelCount !== after.pixelCount;
  return Object.freeze({
    changed: stateChanged || refreshChanged || resolutionChanged,
    stateChanged,
    refreshChanged,
    resolutionChanged,
    hdrChanged: before.hdr !== after.hdr,
    vrrChanged: before.vrr !== after.vrr
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Display-pipeline library clock must return a number');
  return timestamp;
}

export function buildDisplayPipelineEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Display-pipeline library trigger is required');
  }
  return Object.freeze({
    library: DISPLAY_PIPELINE_LIBRARY_ID,
    libraryVersion: DISPLAY_PIPELINE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyDisplayPipeline(facts)
  });
}

export function createDisplayPipelineLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Display-pipeline library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: DISPLAY_PIPELINE_LIBRARY_ID,
    version: DISPLAY_PIPELINE_LIBRARY_VERSION,
    classify: classifyDisplayPipeline,
    compare: compareDisplayPipeline,
    envelope: (facts, envelopeOptions = {}) => buildDisplayPipelineEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
