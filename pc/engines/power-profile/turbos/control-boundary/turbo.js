/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Power-profile control-boundary turbo. It tracks explicit capability evidence
 * and refuses to infer permission when a host does not report the boundary.
 */

export const POWER_PROFILE_CONTROL_TURBO_ID = 'power-profile.control-boundary';
export const POWER_PROFILE_CONTROL_TURBO_VERSION = 1;
export const POWER_PROFILE_CONTROL_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const CONTROL_STATES = Object.freeze(['enabled', 'disabled', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function controlOf(capabilities) {
  if (!isRecord(capabilities) || typeof capabilities.powerProfileControl !== 'boolean') return 'unknown';
  return capabilities.powerProfileControl ? 'enabled' : 'disabled';
}

function activeOf(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('Power-profile control-boundary snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Power-profile control-boundary requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.powerProfile)) {
    throw new TypeError('Power-profile control-boundary snapshot requires a profile object');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const control = controlOf(source.capabilities);
  return Object.freeze({
    control,
    active: activeOf(source.powerProfile.active),
    observable: control !== 'unknown'
  });
}

function requireTrigger(trigger) {
  if (!POWER_PROFILE_CONTROL_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported power-profile control-boundary trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Power-profile control-boundary windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Power-profile control-boundary minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(name, value, windowSize) {
  if (!Number.isInteger(value) || value < 1 || value > windowSize) {
    throw new RangeError(`Power-profile control-boundary ${name} must be an integer from 1 to ${windowSize}`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Power-profile control-boundary clock must return a number');
  }
  return timestamp;
}

function comparisons(evidence) {
  return evidence.slice(1).map((current, index) => Object.freeze({
    changed: evidence[index].control !== current.control,
    enabledToDisabled: evidence[index].control === 'enabled' && current.control === 'disabled',
    disabledToEnabled: evidence[index].control === 'disabled' && current.control === 'enabled'
  }));
}

function stateFor(sampleCount, minimumSamples, observedCount, disabledCount,
  controlChangeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'capability-unknown';
  if (controlChangeCount >= persistenceThreshold) return 'control-drift-sustained';
  if (controlChangeCount > 0) return 'control-drift-observed';
  if (disabledCount > 0) return 'control-disabled';
  return 'stable-control';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-control-samples']);
  if (state === 'capability-unknown') return Object.freeze(['request-explicit-power-profile-capability']);
  if (state === 'control-disabled') return Object.freeze(['preserve-disabled-power-profile-control']);
  if (state === 'control-drift-sustained') return Object.freeze(['review-power-profile-capability-drift']);
  if (state === 'control-drift-observed') return Object.freeze(['observe-power-profile-capability-stability']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleWeight = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleWeight * 10000) / 10000;
}

export function runPowerProfileControlBoundaryTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('Power-profile control-boundary samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireThreshold('persistenceThreshold', persistenceThreshold, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const changes = comparisons(evidence);
  const observedCount = evidence.filter((item) => item.observable).length;
  const unknownCount = selected.length - observedCount;
  const enabledCount = evidence.filter((item) => item.control === 'enabled').length;
  const disabledCount = evidence.filter((item) => item.control === 'disabled').length;
  const controlChangeCount = changes.filter((item) => item.changed).length;
  const enabledToDisabledCount = changes.filter((item) => item.enabledToDisabled).length;
  const disabledToEnabledCount = changes.filter((item) => item.disabledToEnabled).length;
  const state = stateFor(selected.length, requiredSamples, observedCount, disabledCount,
    controlChangeCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: POWER_PROFILE_CONTROL_TURBO_ID,
    turboVersion: POWER_PROFILE_CONTROL_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    observedCount,
    unknownCount,
    enabledCount,
    disabledCount,
    comparisonCount: changes.length,
    controlChangeCount,
    enabledToDisabledCount,
    disabledToEnabledCount,
    finalControl: evidence.at(-1)?.control || 'unknown',
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
