/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Background-services engine. It reports service state and ownership evidence
 * without disabling, stopping, starting, or changing service files.
 */

export const BACKGROUND_SERVICES_ENGINE_ID = 'background-services';
export const BACKGROUND_SERVICES_ENGINE_VERSION = 1;
export const BACKGROUND_SERVICES_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const SERVICE_STATES = Object.freeze(['running', 'stopped', 'failed']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stateOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
  const normalized = value.trim().toLowerCase();
  return SERVICE_STATES.includes(normalized) ? normalized : 'unknown';
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Background-services facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Background-services requires system-facts facts');
  if (!Array.isArray(facts.services)) throw new TypeError('Background-services facts require a service list');
  return facts;
}

function requireTrigger(trigger) {
  if (!BACKGROUND_SERVICES_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported background-services trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Background-services clock must return a number');
  return timestamp;
}

function operatingState(environment, observation, count, unknownCount, criticalFailureCount) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-services';
  if (observation === false) return 'observation-disabled';
  if (criticalFailureCount > 0) return 'protect-services';
  if (unknownCount > 0) return 'observation-required';
  return 'observe';
}

function recommendations(environment, observation, count, unknownCount, criticalFailureCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-background-service-review']);
  if (observation === false) return Object.freeze(['keep-service-observation-disabled']);
  if (criticalFailureCount > 0) return Object.freeze(['protect-services', 'review-service-owner']);
  if (unknownCount > 0) return Object.freeze(['request-service-state-observation']);
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

export function runBackgroundServicesEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const services = source.services.filter(isRecord).map((service) => ({
    name: text(service.name),
    state: stateOf(service.state),
    critical: service.critical === true,
    userOwned: service.userOwned === true
  }));
  const unknownCount = services.filter((service) => service.state === 'unknown').length;
  const criticalFailureCount = services.filter((service) => service.critical && service.state === 'failed').length;
  const namedCount = services.filter((service) => service.name !== null).length;
  const observation = source.capabilities?.backgroundServiceObservation !== false;
  return Object.freeze({
    protocolVersion: 1,
    engine: BACKGROUND_SERVICES_ENGINE_ID,
    engineVersion: BACKGROUND_SERVICES_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    serviceCount: services.length,
    names: Object.freeze(services.map((service) => service.name).filter(Boolean)),
    runningCount: services.filter((service) => service.state === 'running').length,
    stoppedCount: services.filter((service) => service.state === 'stopped').length,
    failedCount: services.filter((service) => service.state === 'failed').length,
    criticalFailureCount,
    unknownStateCount: unknownCount,
    userOwnedCount: services.filter((service) => service.userOwned).length,
    observationEnabled: observation,
    state: operatingState(environment, observation, services.length, unknownCount, criticalFailureCount),
    confidence: confidence(environment, services.length, unknownCount, namedCount),
    recommendations: recommendations(environment, observation, services.length, unknownCount, criticalFailureCount),
    actions: EMPTY_ARRAY
  });
}
