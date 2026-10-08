/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Power-profile availability-drift turbo. It tracks the explicit advertised
 * profile set and active-profile membership without changing power policy.
 */

export const POWER_PROFILE_AVAILABILITY_TURBO_ID = 'power-profile.availability-drift';
export const POWER_PROFILE_AVAILABILITY_TURBO_VERSION = 1;
export const POWER_PROFILE_AVAILABILITY_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function activeOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value.trim().toLowerCase();
}

function availableOf(value) {
  if (!Array.isArray(value)) return EMPTY_ARRAY;
  return Object.freeze(value
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().toLowerCase())
    .filter((item, index, list) => list.indexOf(item) === index));
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('Power-profile availability-drift snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Power-profile availability-drift requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.powerProfile)) {
    throw new TypeError('Power-profile availability-drift snapshot requires a profile object');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const profile = source.powerProfile;
  const active = activeOf(profile.active);
  const available = availableOf(profile.available);
  return Object.freeze({
    active,
    available,
    signature: available.join(','),
    observed: available.length > 0,
    activeAdvertised: active === null || available.includes(active)
  });
}

function requireTrigger(trigger) {
  if (!POWER_PROFILE_AVAILABILITY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported power-profile availability-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Power-profile availability-drift windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Power-profile availability-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(name, value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) {
    throw new RangeError(`Power-profile availability-drift ${name} must be an integer from 1 to ${windowSize}`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Power-profile availability-drift clock must return a number');
  }
  return timestamp;
}

function setDifference(before, after) {
  return after.filter((item) => !before.includes(item)).length
    + before.filter((item) => !after.includes(item)).length;
}

function comparisons(evidence) {
  return evidence.slice(1).map((current, index) => {
    const previous = evidence[index];
    return Object.freeze({
      changed: previous.signature !== current.signature,
      addedCount: current.available.filter((item) => !previous.available.includes(item)).length,
      removedCount: previous.available.filter((item) => !current.available.includes(item)).length,
      distance: setDifference(previous.available, current.available)
    });
  });
}

function stateFor(sampleCount, minimumSamples, observedCount, missingActiveCount,
  availabilityChangeCount, persistenceThreshold, missingActiveThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-availability';
  if (missingActiveCount >= missingActiveThreshold) return 'active-not-advertised';
  if (availabilityChangeCount >= persistenceThreshold) return 'availability-drift-sustained';
  if (availabilityChangeCount > 0) return 'availability-drift-observed';
  return 'stable-availability';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-available-profile-samples']);
  if (state === 'no-availability') return Object.freeze(['request-available-profile-observation']);
  if (state === 'active-not-advertised') return Object.freeze(['review-active-profile-membership']);
  if (state === 'availability-drift-sustained') return Object.freeze(['review-profile-availability-drift']);
  if (state === 'availability-drift-observed') return Object.freeze(['observe-profile-availability-stability']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleWeight = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleWeight * 10000) / 10000;
}

export function runPowerProfileAvailabilityDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  missingActiveThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('Power-profile availability-drift samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold('persistenceThreshold', persistenceThreshold, boundedWindow);
  const requiredMissing = requireThreshold('missingActiveThreshold', missingActiveThreshold, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const changes = comparisons(evidence);
  const observedCount = evidence.filter((item) => item.observed).length;
  const missingActiveCount = evidence.filter((item) => !item.activeAdvertised).length;
  const availabilityChangeCount = changes.filter((item) => item.changed).length;
  const addedCount = changes.reduce((sum, item) => sum + item.addedCount, 0);
  const removedCount = changes.reduce((sum, item) => sum + item.removedCount, 0);
  const state = stateFor(selected.length, requiredSamples, observedCount, missingActiveCount,
    availabilityChangeCount, requiredPersistence, requiredMissing);
  return Object.freeze({
    protocolVersion: 1,
    turbo: POWER_PROFILE_AVAILABILITY_TURBO_ID,
    turboVersion: POWER_PROFILE_AVAILABILITY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    missingActiveThreshold: requiredMissing,
    observedCount,
    unknownCount: selected.length - observedCount,
    comparisonCount: changes.length,
    availabilityChangeCount,
    addedCount,
    removedCount,
    missingActiveCount,
    finalAvailable: evidence.at(-1)?.available || EMPTY_ARRAY,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
