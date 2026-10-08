/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Startup library. It classifies bounded startup evidence without disabling
 * entries, changing boot configuration, or modifying files.
 */

export const STARTUP_LIBRARY_ID = 'startup-library';
export const STARTUP_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Startup library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Startup library requires normalized system facts');
  }
  if (!Array.isArray(facts.startup)) throw new TypeError('Startup library requires a startup list');
  return facts;
}

function stateFor(environment, count, unknownCount, requiredDisabledCount, userOwnedEnabledCount) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-startup-items';
  if (unknownCount > 0) return 'observation-required';
  if (requiredDisabledCount > 0) return 'required-review';
  if (userOwnedEnabledCount > 0) return 'user-owned-review';
  return 'observe';
}

function recommendations(environment, count, unknownCount, requiredDisabledCount, userOwnedEnabledCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-startup-review']);
  if (unknownCount > 0) return Object.freeze(['request-startup-observation']);
  if (requiredDisabledCount > 0) return Object.freeze(['review-required-startup-owner']);
  if (userOwnedEnabledCount > 0) return Object.freeze(['review-user-owned-startup-items']);
  return Object.freeze(['no-change']);
}

function confidence(environment, count, unknownCount, namedCount) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (count > 0) score += 0.2;
  if (count > 0 && unknownCount === 0) score += 0.3;
  if (count > 0 && namedCount === count) score += 0.3;
  return Math.round(score * 10000) / 10000;
}

function maximumDelay(entries) {
  return entries.reduce((maximum, entry) => {
    if (entry.delayMs === null) return maximum;
    return maximum === null ? entry.delayMs : Math.max(maximum, entry.delayMs);
  }, null);
}

export function classifyStartup(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const entries = source.startup.filter(isRecord).map((entry) => ({
    name: text(entry.name),
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : null,
    required: entry.required === true,
    userOwned: entry.userOwned === true,
    delayMs: nonNegative(entry.delayMs)
  }));
  const enabledCount = entries.filter((entry) => entry.enabled === true).length;
  const disabledCount = entries.filter((entry) => entry.enabled === false).length;
  const unknownCount = entries.filter((entry) => entry.enabled === null).length;
  const requiredDisabledCount = entries.filter((entry) => entry.required && entry.enabled === false).length;
  const userOwnedEnabledCount = entries.filter((entry) => entry.userOwned && entry.enabled === true).length;
  const namedCount = entries.filter((entry) => entry.name !== null).length;
  return Object.freeze({
    library: STARTUP_LIBRARY_ID,
    libraryVersion: STARTUP_LIBRARY_VERSION,
    environment,
    startupCount: entries.length,
    names: Object.freeze(entries.map((entry) => entry.name).filter(Boolean)),
    enabledCount,
    disabledCount,
    unknownCount,
    requiredDisabledCount,
    userOwnedEnabledCount,
    maximumDelayMs: maximumDelay(entries),
    state: stateFor(environment, entries.length, unknownCount, requiredDisabledCount, userOwnedEnabledCount),
    confidence: confidence(environment, entries.length, unknownCount, namedCount),
    recommendations: recommendations(environment, entries.length, unknownCount, requiredDisabledCount, userOwnedEnabledCount)
  });
}

export function compareStartup(previous, current) {
  const before = classifyStartup(previous);
  const after = classifyStartup(current);
  const stateChanged = before.state !== after.state;
  const countChanged = before.startupCount !== after.startupCount;
  const enabledChanged = before.enabledCount !== after.enabledCount;
  const disabledChanged = before.disabledCount !== after.disabledCount;
  const unknownChanged = before.unknownCount !== after.unknownCount;
  const requiredChanged = before.requiredDisabledCount !== after.requiredDisabledCount;
  const userOwnedChanged = before.userOwnedEnabledCount !== after.userOwnedEnabledCount;
  const delayChanged = before.maximumDelayMs !== after.maximumDelayMs;
  return Object.freeze({
    changed: stateChanged || countChanged || enabledChanged || disabledChanged || unknownChanged
      || requiredChanged || userOwnedChanged || delayChanged,
    stateChanged,
    countChanged,
    enabledChanged,
    disabledChanged,
    unknownChanged,
    requiredChanged,
    userOwnedChanged,
    delayChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Startup library clock must return a number');
  return timestamp;
}

export function buildStartupEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Startup library trigger is required');
  }
  return Object.freeze({
    library: STARTUP_LIBRARY_ID,
    libraryVersion: STARTUP_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyStartup(facts)
  });
}

export function createStartupLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Startup library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: STARTUP_LIBRARY_ID,
    version: STARTUP_LIBRARY_VERSION,
    classify: classifyStartup,
    compare: compareStartup,
    envelope: (facts, envelopeOptions = {}) => buildStartupEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
