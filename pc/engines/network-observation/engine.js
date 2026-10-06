/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Network-observation engine. It reports bounded link and route evidence
 * without changing network settings, routes, files, or transport state.
 */

export const NETWORK_OBSERVATION_ENGINE_ID = 'network-observation';
export const NETWORK_OBSERVATION_ENGINE_VERSION = 1;
export const NETWORK_OBSERVATION_TRIGGERS = Object.freeze([
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

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Network-observation facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Network-observation requires system-facts facts');
  if (!Array.isArray(facts.network)) throw new TypeError('Network-observation facts require a network list');
  return facts;
}

function requireTrigger(trigger) {
  if (!NETWORK_OBSERVATION_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported network-observation trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Network-observation clock must return a number');
  return timestamp;
}

function operatingState(environment, observation, count, defaultRouteCount) {
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

export function runNetworkObservationEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
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
    protocolVersion: 1,
    engine: NETWORK_OBSERVATION_ENGINE_ID,
    engineVersion: NETWORK_OBSERVATION_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    linkCount: links.length,
    names: Object.freeze(links.map((link) => link.name).filter(Boolean)),
    kinds: Object.freeze(links.map((link) => link.kind).filter(Boolean)),
    states: Object.freeze(links.map((link) => link.state).filter(Boolean)),
    meshLinkCount: links.filter((link) => link.mesh).length,
    defaultRouteCount,
    stateKnown,
    observationEnabled: observation,
    state: operatingState(environment, observation, links.length, defaultRouteCount),
    confidence: confidence(environment, links.length, stateKnown, defaultRouteCount),
    recommendations: recommendations(environment, observation, links.length, defaultRouteCount),
    actions: EMPTY_ARRAY
  });
}
