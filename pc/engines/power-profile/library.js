/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Power-profile library. It classifies documented profile evidence and the
 * declared control boundary without switching profiles or changing policy.
 */

export const POWER_PROFILE_LIBRARY_ID = 'power-profile-library';
export const POWER_PROFILE_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const PROFILES = Object.freeze(['powersave', 'balanced', 'performance']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function profileOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
  const normalized = value.trim().toLowerCase();
  return PROFILES.includes(normalized) ? normalized : 'custom';
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Power-profile library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Power-profile library requires normalized system facts');
  }
  if (!isRecord(facts.powerProfile)) {
    throw new TypeError('Power-profile library requires a profile object');
  }
  return facts;
}

function stateFor(environment, control, active) {
  if (environment === 'unknown') return 'profile-required';
  if (control === false) return 'control-disabled';
  if (active === 'unknown') return 'observation-required';
  if (active === 'custom') return 'review-custom';
  return 'observe';
}

function recommendations(environment, control, active) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (control === false) return Object.freeze(['preserve-power-profile-control-boundary']);
  if (active === 'unknown') return Object.freeze(['request-power-profile-observation']);
  if (active === 'custom') return Object.freeze(['review-user-owned-power-profile']);
  return Object.freeze(['no-change']);
}

function confidence(environment, active, availableCount) {
  let score = 0;
  if (environment !== 'unknown') score += 0.25;
  if (active !== 'unknown') score += 0.5;
  if (availableCount > 0) score += 0.25;
  return Math.round(score * 10000) / 10000;
}

export function classifyPowerProfile(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const profile = source.powerProfile;
  const active = profileOf(profile.active);
  const available = Array.isArray(profile.available)
    ? profile.available.map(text).filter(Boolean)
    : [];
  const control = source.capabilities?.powerProfileControl !== false;
  return Object.freeze({
    library: POWER_PROFILE_LIBRARY_ID,
    libraryVersion: POWER_PROFILE_LIBRARY_VERSION,
    environment,
    activeProfile: active,
    availableProfiles: Object.freeze(available),
    controlEnabled: control,
    state: stateFor(environment, control, active),
    confidence: confidence(environment, active, available.length),
    recommendations: recommendations(environment, control, active)
  });
}

export function comparePowerProfile(previous, current) {
  const before = classifyPowerProfile(previous);
  const after = classifyPowerProfile(current);
  const stateChanged = before.state !== after.state;
  const activeChanged = before.activeProfile !== after.activeProfile;
  const availableChanged = before.availableProfiles.join('|') !== after.availableProfiles.join('|');
  const controlChanged = before.controlEnabled !== after.controlEnabled;
  return Object.freeze({
    changed: stateChanged || activeChanged || availableChanged || controlChanged,
    stateChanged,
    activeChanged,
    availableChanged,
    controlChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Power-profile library clock must return a number');
  return timestamp;
}

export function buildPowerProfileEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Power-profile library trigger is required');
  }
  return Object.freeze({
    library: POWER_PROFILE_LIBRARY_ID,
    libraryVersion: POWER_PROFILE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyPowerProfile(facts)
  });
}

export function createPowerProfileLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Power-profile library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: POWER_PROFILE_LIBRARY_ID,
    version: POWER_PROFILE_LIBRARY_VERSION,
    classify: classifyPowerProfile,
    compare: comparePowerProfile,
    envelope: (facts, envelopeOptions = {}) => buildPowerProfileEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
