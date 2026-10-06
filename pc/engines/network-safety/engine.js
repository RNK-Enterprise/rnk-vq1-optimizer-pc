/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Network-safety engine. It classifies explicit trust and encryption evidence
 * without changing routes, DNS, MTU, QoS, firewalls, files, or transport.
 */

export const NETWORK_SAFETY_ENGINE_ID = 'network-safety';
export const NETWORK_SAFETY_ENGINE_VERSION = 1;
export const NETWORK_SAFETY_TRIGGERS = Object.freeze([
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

function riskOf(link) {
  if (link.trusted === false) return 'review';
  if (link.public === true && link.encrypted !== true) return 'review';
  if (link.trusted === true && (link.encrypted === true || link.public !== true)) return 'observed';
  return 'unknown';
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Network-safety facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Network-safety requires system-facts facts');
  if (!Array.isArray(facts.network)) throw new TypeError('Network-safety facts require a network list');
  return facts;
}

function requireTrigger(trigger) {
  if (!NETWORK_SAFETY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported network-safety trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Network-safety clock must return a number');
  return timestamp;
}

function operatingState(environment, observation, count, reviewCount, unknownCount) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-network';
  if (observation === false) return 'observation-disabled';
  if (reviewCount > 0) return 'review-required';
  if (unknownCount > 0) return 'observation-required';
  return 'observe';
}

function recommendations(environment, observation, count, reviewCount, unknownCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-network-safety-review']);
  if (observation === false) return Object.freeze(['keep-network-safety-observation-disabled']);
  if (reviewCount > 0) return Object.freeze(['review-network-safety-evidence']);
  if (unknownCount > 0) return Object.freeze(['request-network-safety-observation']);
  return Object.freeze(['no-change']);
}

function confidence(environment, count, reviewCount, unknownCount) {
  let score = 0;
  if (environment !== 'unknown') score += 0.25;
  if (count > 0) score += 0.25;
  if (count > 0 && reviewCount === 0) score += 0.25;
  if (count > 0 && unknownCount === 0) score += 0.25;
  return Math.round(score * 10000) / 10000;
}

export function runNetworkSafetyEngine(facts, {
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
    risk: riskOf(link),
    encrypted: link.encrypted === true,
    trusted: link.trusted === true,
    public: link.public === true
  }));
  const reviewCount = links.filter((link) => link.risk === 'review').length;
  const unknownCount = links.filter((link) => link.risk === 'unknown').length;
  const observation = source.capabilities?.networkObservation !== false;
  return Object.freeze({
    protocolVersion: 1,
    engine: NETWORK_SAFETY_ENGINE_ID,
    engineVersion: NETWORK_SAFETY_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    linkCount: links.length,
    names: Object.freeze(links.map((link) => link.name).filter(Boolean)),
    reviewCount,
    unknownCount,
    encryptedCount: links.filter((link) => link.encrypted).length,
    trustedCount: links.filter((link) => link.trusted).length,
    publicCount: links.filter((link) => link.public).length,
    observationEnabled: observation,
    state: operatingState(environment, observation, links.length, reviewCount, unknownCount),
    confidence: confidence(environment, links.length, reviewCount, unknownCount),
    recommendations: recommendations(environment, observation, links.length, reviewCount, unknownCount),
    actions: EMPTY_ARRAY
  });
}
