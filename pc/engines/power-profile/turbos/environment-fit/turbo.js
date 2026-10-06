/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Power-profile environment-fit turbo. It compares explicit host posture with
 * documented profile observations without selecting or switching a profile.
 */

export const POWER_PROFILE_ENVIRONMENT_TURBO_ID = 'power-profile.environment-fit';
export const POWER_PROFILE_ENVIRONMENT_TURBO_VERSION = 1;
export const POWER_PROFILE_ENVIRONMENT_TRIGGERS = Object.freeze([
  'install.preflight',
  'workload.changed',
  'health.interval'
]);

const PROFILES = Object.freeze(['powersave', 'balanced', 'performance']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function environmentOf(value) {
  return ENVIRONMENTS.includes(value) ? value : 'unknown';
}

function profileOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
  const normalized = value.trim().toLowerCase();
  return PROFILES.includes(normalized) ? normalized : 'custom';
}

function targetFor(environment) {
  if (environment === 'interactive') return 'balanced';
  if (environment === 'headless') return 'performance';
  return null;
}

function fitFor(environment, profile) {
  const target = targetFor(environment);
  if (target === null) return 'environment-unknown';
  if (profile === 'unknown') return 'profile-unknown';
  if (profile === 'custom') return 'custom-profile';
  return profile === target ? 'aligned' : 'mismatch';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('Power-profile environment-fit snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Power-profile environment-fit requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.powerProfile)) {
    throw new TypeError('Power-profile environment-fit snapshot requires a profile object');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const environment = environmentOf(source.environment);
  const profile = profileOf(source.powerProfile.active);
  const target = targetFor(environment);
  return Object.freeze({
    environment,
    profile,
    target,
    fit: fitFor(environment, profile),
    explicitContext: environment !== 'unknown',
    observedProfile: profile !== 'unknown'
  });
}

function requireTrigger(trigger) {
  if (!POWER_PROFILE_ENVIRONMENT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported power-profile environment-fit trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Power-profile environment-fit windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Power-profile environment-fit minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(name, value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) {
    throw new RangeError(`Power-profile environment-fit ${name} must be an integer from 1 to ${windowSize}`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Power-profile environment-fit clock must return a number');
  }
  return timestamp;
}

function comparisons(evidence) {
  return evidence.slice(1).map((current, index) => Object.freeze({
    fitChanged: evidence[index].fit !== current.fit,
    environmentChanged: evidence[index].environment !== current.environment,
    profileChanged: evidence[index].profile !== current.profile
  }));
}

function stateFor(sampleCount, minimumSamples, environmentUnknownCount, profileUnknownCount,
  customCount, mismatchCount, alignedCount, mismatchThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (environmentUnknownCount === sampleCount) return 'environment-unknown';
  if (profileUnknownCount === sampleCount) return 'profile-unknown';
  if (customCount >= mismatchThreshold) return 'custom-profile-review';
  if (mismatchCount >= mismatchThreshold) return 'profile-mismatch-sustained';
  if (mismatchCount > 0) return 'profile-mismatch-observed';
  if (alignedCount > 0) return 'profile-aligned';
  return 'profile-unknown';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-environment-profile-samples']);
  if (state === 'environment-unknown') return Object.freeze(['request-environment-profile']);
  if (state === 'profile-unknown') return Object.freeze(['request-active-profile-observation']);
  if (state === 'custom-profile-review') return Object.freeze(['review-user-owned-custom-profile']);
  if (state === 'profile-mismatch-sustained') return Object.freeze(['review-profile-fit-without-switching']);
  if (state === 'profile-mismatch-observed') return Object.freeze(['observe-profile-fit-stability']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, knownCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleWeight = Math.min(1, sampleCount / minimumSamples);
  return Math.round((knownCount / sampleCount) * sampleWeight * 10000) / 10000;
}

export function runPowerProfileEnvironmentFitTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  mismatchThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('Power-profile environment-fit samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredMismatch = requireThreshold('mismatchThreshold', mismatchThreshold, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const changes = comparisons(evidence);
  const environmentUnknownCount = evidence.filter((item) => !item.explicitContext).length;
  const profileUnknownCount = evidence.filter((item) => !item.observedProfile).length;
  const customCount = evidence.filter((item) => item.fit === 'custom-profile').length;
  const mismatchCount = evidence.filter((item) => item.fit === 'mismatch').length;
  const alignedCount = evidence.filter((item) => item.fit === 'aligned').length;
  const knownCount = evidence.filter((item) => item.fit === 'aligned' || item.fit === 'mismatch'
    || item.fit === 'custom-profile').length;
  const state = stateFor(selected.length, requiredSamples, environmentUnknownCount, profileUnknownCount,
    customCount, mismatchCount, alignedCount, requiredMismatch);
  return Object.freeze({
    protocolVersion: 1,
    turbo: POWER_PROFILE_ENVIRONMENT_TURBO_ID,
    turboVersion: POWER_PROFILE_ENVIRONMENT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    mismatchThreshold: requiredMismatch,
    environmentUnknownCount,
    profileUnknownCount,
    customCount,
    mismatchCount,
    alignedCount,
    knownCount,
    comparisonCount: changes.length,
    fitChangeCount: changes.filter((item) => item.fitChanged).length,
    environmentChangeCount: changes.filter((item) => item.environmentChanged).length,
    profileChangeCount: changes.filter((item) => item.profileChanged).length,
    finalEnvironment: evidence.at(-1)?.environment || 'unknown',
    finalProfile: evidence.at(-1)?.profile || 'unknown',
    finalTarget: evidence.at(-1)?.target || null,
    state,
    confidence: confidence(selected.length, knownCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
