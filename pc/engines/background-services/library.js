/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Background-services library. It classifies bounded service evidence without
 * disabling, stopping, starting, or changing service files.
 */

export const BACKGROUND_SERVICES_LIBRARY_ID = 'background-services-library';
export const BACKGROUND_SERVICES_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const SERVICE_STATES = Object.freeze(['running', 'stopped', 'failed']);

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
  if (!isRecord(facts)) throw new TypeError('Background-services library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Background-services library requires normalized system facts');
  }
  if (!Array.isArray(facts.services)) {
    throw new TypeError('Background-services library requires a service list');
  }
  return facts;
}

function stateFor(environment, observation, count, unknownCount, criticalFailureCount) {
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

export function classifyBackgroundServices(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const services = source.services.filter(isRecord).map((service) => ({
    name: text(service.name),
    state: stateOf(service.state),
    critical: service.critical === true,
    userOwned: service.userOwned === true
  }));
  const runningCount = services.filter((service) => service.state === 'running').length;
  const stoppedCount = services.filter((service) => service.state === 'stopped').length;
  const failedCount = services.filter((service) => service.state === 'failed').length;
  const unknownCount = services.filter((service) => service.state === 'unknown').length;
  const criticalFailureCount = services
    .filter((service) => service.critical && service.state === 'failed').length;
  const namedCount = services.filter((service) => service.name !== null).length;
  const observation = source.capabilities?.backgroundServiceObservation !== false;
  return Object.freeze({
    library: BACKGROUND_SERVICES_LIBRARY_ID,
    libraryVersion: BACKGROUND_SERVICES_LIBRARY_VERSION,
    environment,
    serviceCount: services.length,
    names: Object.freeze(services.map((service) => service.name).filter(Boolean)),
    runningCount,
    stoppedCount,
    failedCount,
    criticalFailureCount,
    unknownStateCount: unknownCount,
    userOwnedCount: services.filter((service) => service.userOwned).length,
    observationEnabled: observation,
    state: stateFor(environment, observation, services.length, unknownCount, criticalFailureCount),
    confidence: confidence(environment, services.length, unknownCount, namedCount),
    recommendations: recommendations(environment, observation, services.length, unknownCount, criticalFailureCount)
  });
}

export function compareBackgroundServices(previous, current) {
  const before = classifyBackgroundServices(previous);
  const after = classifyBackgroundServices(current);
  const stateChanged = before.state !== after.state;
  const countChanged = before.serviceCount !== after.serviceCount;
  const runningChanged = before.runningCount !== after.runningCount;
  const stoppedChanged = before.stoppedCount !== after.stoppedCount;
  const failedChanged = before.failedCount !== after.failedCount;
  const criticalChanged = before.criticalFailureCount !== after.criticalFailureCount;
  const unknownChanged = before.unknownStateCount !== after.unknownStateCount;
  const ownershipChanged = before.userOwnedCount !== after.userOwnedCount;
  const observationChanged = before.observationEnabled !== after.observationEnabled;
  return Object.freeze({
    changed: stateChanged || countChanged || runningChanged || stoppedChanged || failedChanged
      || criticalChanged || unknownChanged || ownershipChanged || observationChanged,
    stateChanged,
    countChanged,
    runningChanged,
    stoppedChanged,
    failedChanged,
    criticalChanged,
    unknownChanged,
    ownershipChanged,
    observationChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Background-services library clock must return a number');
  return timestamp;
}

export function buildBackgroundServicesEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Background-services library trigger is required');
  }
  return Object.freeze({
    library: BACKGROUND_SERVICES_LIBRARY_ID,
    libraryVersion: BACKGROUND_SERVICES_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyBackgroundServices(facts)
  });
}

export function createBackgroundServicesLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Background-services library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: BACKGROUND_SERVICES_LIBRARY_ID,
    version: BACKGROUND_SERVICES_LIBRARY_VERSION,
    classify: classifyBackgroundServices,
    compare: compareBackgroundServices,
    envelope: (facts, envelopeOptions = {}) => buildBackgroundServicesEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
