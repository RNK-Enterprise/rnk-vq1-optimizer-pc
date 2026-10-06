/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Startup engine. It reports startup entries and ownership evidence without
 * disabling entries, changing boot configuration, or modifying files.
 */

export const STARTUP_ENGINE_ID = 'startup';
export const STARTUP_ENGINE_VERSION = 1;
export const STARTUP_TRIGGERS = Object.freeze([
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

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Startup facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Startup requires system-facts facts');
  if (!Array.isArray(facts.startup)) throw new TypeError('Startup facts require a startup list');
  return facts;
}

function requireTrigger(trigger) {
  if (!STARTUP_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported startup trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Startup clock must return a number');
  return timestamp;
}

function operatingState(environment, count, unknownCount, requiredDisabledCount, userOwnedEnabledCount) {
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

export function runStartupEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const entries = source.startup.filter(isRecord).map((entry) => ({
    name: text(entry.name),
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : null,
    required: entry.required === true,
    userOwned: entry.userOwned === true,
    delayMs: nonNegative(entry.delayMs)
  }));
  const unknownCount = entries.filter((entry) => entry.enabled === null).length;
  const requiredDisabledCount = entries.filter((entry) => entry.required && entry.enabled === false).length;
  const userOwnedEnabledCount = entries.filter((entry) => entry.userOwned && entry.enabled === true).length;
  const namedCount = entries.filter((entry) => entry.name !== null).length;
  return Object.freeze({
    protocolVersion: 1,
    engine: STARTUP_ENGINE_ID,
    engineVersion: STARTUP_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    startupCount: entries.length,
    names: Object.freeze(entries.map((entry) => entry.name).filter(Boolean)),
    enabledCount: entries.filter((entry) => entry.enabled === true).length,
    disabledCount: entries.filter((entry) => entry.enabled === false).length,
    unknownCount,
    requiredDisabledCount,
    userOwnedEnabledCount,
    maximumDelayMs: entries.reduce((maximum, entry) => {
      if (entry.delayMs === null) return maximum;
      return maximum === null ? entry.delayMs : Math.max(maximum, entry.delayMs);
    }, null),
    state: operatingState(environment, entries.length, unknownCount, requiredDisabledCount, userOwnedEnabledCount),
    confidence: confidence(environment, entries.length, unknownCount, namedCount),
    recommendations: recommendations(environment, entries.length, unknownCount, requiredDisabledCount, userOwnedEnabledCount),
    actions: EMPTY_ARRAY
  });
}
