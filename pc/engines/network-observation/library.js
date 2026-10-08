/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Network-observation library. It classifies bounded link and route evidence
 * without changing network settings, routes, files, or transport state.
 */

export const NETWORK_OBSERVATION_LIBRARY_ID = 'network-observation-library';
export const NETWORK_OBSERVATION_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Network-observation library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Network-observation library requires normalized system facts');
  }
  if (!Array.isArray(facts.network)) {
    throw new TypeError('Network-observation library requires a network list');
  }
  return facts;
}

function stateFor(environment, observation, count, defaultRouteCount) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-network';
  if (observation === false) return 'observation-disabled';
  if (defaultRouteCount > 1) return 'route-review';
  return 'observe';
}

function recommendations(environment, observation, count, defaultRouteCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-network-review']);
  if (observation === false) return Object.freeze(['keep-network-observation-disabled']);
  if (defaultRouteCount > 1) return Object.freeze(['review-routes-without-network-mutation']);
  return Object.freeze(['no-change']);
}

function confidence(environment, count, stateKnown, defaultRouteCount) {
  let score = 0;
  if (environment !== 'unknown') score += 0.25;
  if (count > 0) score += 0.25;
  if (stateKnown) score += 0.25;
  if (defaultRouteCount <= 1) score += 0.25;
  return Math.round(score * 10000) / 10000;
}

export function classifyNetworkObservation(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const links = source.network.filter(isRecord).map((link) => ({
    name: text(link.name),
    kind: text(link.kind),
    state: text(link.state),
    mesh: link.mesh === true,
    defaultRoute: link.defaultRoute === true
  }));
  const defaultRouteCount = links.filter((link) => link.defaultRoute).length;
  const stateKnown = links.every((link) => link.state !== null);
  const observation = source.capabilities?.networkObservation !== false;
  return Object.freeze({
    library: NETWORK_OBSERVATION_LIBRARY_ID,
    libraryVersion: NETWORK_OBSERVATION_LIBRARY_VERSION,
    environment,
    linkCount: links.length,
    names: Object.freeze(links.map((link) => link.name).filter(Boolean)),
    kinds: Object.freeze(links.map((link) => link.kind).filter(Boolean)),
    states: Object.freeze(links.map((link) => link.state).filter(Boolean)),
    meshLinkCount: links.filter((link) => link.mesh).length,
    defaultRouteCount,
    stateKnown,
    observationEnabled: observation,
    state: stateFor(environment, observation, links.length, defaultRouteCount),
    confidence: confidence(environment, links.length, stateKnown, defaultRouteCount),
    recommendations: recommendations(environment, observation, links.length, defaultRouteCount)
  });
}

export function compareNetworkObservation(previous, current) {
  const before = classifyNetworkObservation(previous);
  const after = classifyNetworkObservation(current);
  const stateChanged = before.state !== after.state;
  const countChanged = before.linkCount !== after.linkCount;
  const meshChanged = before.meshLinkCount !== after.meshLinkCount;
  const routeChanged = before.defaultRouteCount !== after.defaultRouteCount;
  const knownChanged = before.stateKnown !== after.stateKnown;
  const observationChanged = before.observationEnabled !== after.observationEnabled;
  return Object.freeze({
    changed: stateChanged || countChanged || meshChanged || routeChanged
      || knownChanged || observationChanged,
    stateChanged,
    countChanged,
    meshChanged,
    routeChanged,
    knownChanged,
    observationChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Network-observation library clock must return a number');
  return timestamp;
}

export function buildNetworkObservationEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Network-observation library trigger is required');
  }
  return Object.freeze({
    library: NETWORK_OBSERVATION_LIBRARY_ID,
    libraryVersion: NETWORK_OBSERVATION_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyNetworkObservation(facts)
  });
}

export function createNetworkObservationLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Network-observation library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: NETWORK_OBSERVATION_LIBRARY_ID,
    version: NETWORK_OBSERVATION_LIBRARY_VERSION,
    classify: classifyNetworkObservation,
    compare: compareNetworkObservation,
    envelope: (facts, envelopeOptions = {}) => buildNetworkObservationEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
