/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Power-profile profile-drift turbo. It compares explicit profile evidence
 * across a bounded sample window without switching a profile or changing
 * operating-system policy.
 */

export const POWER_PROFILE_DRIFT_TURBO_ID = 'power-profile.profile-drift';
export const POWER_PROFILE_DRIFT_TURBO_VERSION = 1;
export const POWER_PROFILE_DRIFT_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const PROFILES = Object.freeze(['powersave', 'balanced', 'performance']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function profileOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
  const normalized = value.trim().toLowerCase();
  return PROFILES.includes(normalized) ? normalized : 'custom';
}

function availableOf(value) {
  if (!Array.isArray(value)) return EMPTY_ARRAY;
  return Object.freeze(value
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().toLowerCase())
    .filter((item, index, list) => list.indexOf(item) === index));
}

function environmentOf(value) {
  return ENVIRONMENTS.includes(value) ? value : 'unknown';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('Power-profile profile-drift snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Power-profile profile-drift requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.powerProfile)) {
    throw new TypeError('Power-profile profile-drift snapshot requires a profile object');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const profile = source.powerProfile;
  const active = profileOf(profile.active);
  const available = availableOf(profile.available);
  const controlEnabled = source.capabilities?.powerProfileControl !== false;
  return Object.freeze({
    environment: environmentOf(source.environment),
    active,
    available,
    signature: available.join(','),
    controlEnabled,
    observed: active !== 'unknown'
  });
}

function requireTrigger(trigger) {
  if (!POWER_PROFILE_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported power-profile profile-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Power-profile profile-drift windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Power-profile profile-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(name, value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) {
    throw new RangeError(`Power-profile profile-drift ${name} must be an integer from 1 to ${windowSize}`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Power-profile profile-drift clock must return a number');
  }
  return timestamp;
}

function comparisons(evidence) {
  return evidence.slice(1).map((current, index) => {
    const previous = evidence[index];
    return Object.freeze({
      activeChanged: previous.active !== current.active,
      availabilityChanged: previous.signature !== current.signature,
      controlChanged: previous.controlEnabled !== current.controlEnabled
    });
  });
}

function stateFor(sampleCount, minimumSamples, observedCount, activeChangeCount,
  availabilityChangeCount, controlDisabledCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'profile-unknown';
  if (controlDisabledCount > 0) return 'control-disabled';
  if (activeChangeCount >= persistenceThreshold) return 'profile-drift-sustained';
  if (availabilityChangeCount >= persistenceThreshold) return 'availability-drift';
  if (activeChangeCount > 0) return 'profile-drift-observed';
  return 'stable-profile';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-profile-samples']);
  if (state === 'profile-unknown') return Object.freeze(['request-active-profile-observation']);
  if (state === 'control-disabled') return Object.freeze(['preserve-power-profile-control-boundary']);
  if (state === 'profile-drift-sustained') return Object.freeze(['review-profile-drift-without-switching']);
  if (state === 'availability-drift') return Object.freeze(['observe-available-profile-stability']);
  if (state === 'profile-drift-observed') return Object.freeze(['observe-active-profile-stability']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleWeight = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleWeight * 10000) / 10000;
}

export function runPowerProfileDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('Power-profile profile-drift samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold('persistenceThreshold', persistenceThreshold, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const changes = comparisons(evidence);
  const observedCount = evidence.filter((item) => item.observed).length;
  const unknownCount = evidence.length - observedCount;
  const controlDisabledCount = evidence.filter((item) => !item.controlEnabled).length;
  const activeChangeCount = changes.filter((item) => item.activeChanged).length;
  const availabilityChangeCount = changes.filter((item) => item.availabilityChanged).length;
  const controlChangeCount = changes.filter((item) => item.controlChanged).length;
  const state = stateFor(selected.length, requiredSamples, observedCount, activeChangeCount,
    availabilityChangeCount, controlDisabledCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: POWER_PROFILE_DRIFT_TURBO_ID,
    turboVersion: POWER_PROFILE_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    observedCount,
    unknownCount,
    controlDisabledCount,
    comparisonCount: changes.length,
    activeChangeCount,
    availabilityChangeCount,
    controlChangeCount,
    finalProfile: evidence.at(-1)?.active || 'unknown',
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
