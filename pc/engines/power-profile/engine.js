/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Power-profile engine. It classifies documented active power profiles and
 * control capability without switching profiles or changing system policy.
 */

export const POWER_PROFILE_ENGINE_ID = 'power-profile';
export const POWER_PROFILE_ENGINE_VERSION = 1;
export const POWER_PROFILE_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const PROFILES = Object.freeze(['powersave', 'balanced', 'performance']);
const EMPTY_ARRAY = Object.freeze([]);

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
  if (!isRecord(facts)) throw new TypeError('Power-profile facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Power-profile requires system-facts facts');
  if (!isRecord(facts.powerProfile)) throw new TypeError('Power-profile facts require a profile object');
  return facts;
}

function requireTrigger(trigger) {
  if (!POWER_PROFILE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported power-profile trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Power-profile clock must return a number');
  return timestamp;
}

function operatingState(environment, control, active) {
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

export function runPowerProfileEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const profile = source.powerProfile;
  const active = profileOf(profile.active);
  const available = Array.isArray(profile.available)
    ? profile.available.map(text).filter(Boolean)
    : EMPTY_ARRAY;
  const control = source.capabilities?.powerProfileControl !== false;
  return Object.freeze({
    protocolVersion: 1,
    engine: POWER_PROFILE_ENGINE_ID,
    engineVersion: POWER_PROFILE_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    activeProfile: active,
    availableProfiles: Object.freeze(available),
    controlEnabled: control,
    state: operatingState(environment, control, active),
    confidence: confidence(environment, active, available.length),
    recommendations: recommendations(environment, control, active),
    actions: EMPTY_ARRAY
  });
}
