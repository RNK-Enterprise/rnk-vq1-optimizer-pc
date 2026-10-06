/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Network-safety library. It classifies explicit trust and encryption evidence
 * without changing routes, DNS, MTU, QoS, firewalls, files, or transport.
 */

export const NETWORK_SAFETY_LIBRARY_ID = 'network-safety-library';
export const NETWORK_SAFETY_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

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
  if (!isRecord(facts)) throw new TypeError('Network-safety library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Network-safety library requires normalized system facts');
  }
  if (!Array.isArray(facts.network)) {
    throw new TypeError('Network-safety library requires a network list');
  }
  return facts;
}

function stateFor(environment, observation, count, reviewCount, unknownCount) {
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

export function classifyNetworkSafety(facts) {
  const source = requireFacts(facts);
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
    library: NETWORK_SAFETY_LIBRARY_ID,
    libraryVersion: NETWORK_SAFETY_LIBRARY_VERSION,
    environment,
    linkCount: links.length,
    names: Object.freeze(links.map((link) => link.name).filter(Boolean)),
    reviewCount,
    unknownCount,
    encryptedCount: links.filter((link) => link.encrypted).length,
    trustedCount: links.filter((link) => link.trusted).length,
    publicCount: links.filter((link) => link.public).length,
    observationEnabled: observation,
    state: stateFor(environment, observation, links.length, reviewCount, unknownCount),
    confidence: confidence(environment, links.length, reviewCount, unknownCount),
    recommendations: recommendations(environment, observation, links.length, reviewCount, unknownCount)
  });
}

export function compareNetworkSafety(previous, current) {
  const before = classifyNetworkSafety(previous);
  const after = classifyNetworkSafety(current);
  const stateChanged = before.state !== after.state;
  const countChanged = before.linkCount !== after.linkCount;
  const reviewChanged = before.reviewCount !== after.reviewCount;
  const unknownChanged = before.unknownCount !== after.unknownCount;
  const encryptedChanged = before.encryptedCount !== after.encryptedCount;
  const trustedChanged = before.trustedCount !== after.trustedCount;
  const publicChanged = before.publicCount !== after.publicCount;
  const observationChanged = before.observationEnabled !== after.observationEnabled;
  return Object.freeze({
    changed: stateChanged || countChanged || reviewChanged || unknownChanged
      || encryptedChanged || trustedChanged || publicChanged || observationChanged,
    stateChanged,
    countChanged,
    reviewChanged,
    unknownChanged,
    encryptedChanged,
    trustedChanged,
    publicChanged,
    observationChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Network-safety library clock must return a number');
  return timestamp;
}

export function buildNetworkSafetyEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Network-safety library trigger is required');
  }
  return Object.freeze({
    library: NETWORK_SAFETY_LIBRARY_ID,
    libraryVersion: NETWORK_SAFETY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyNetworkSafety(facts)
  });
}

export function createNetworkSafetyLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Network-safety library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: NETWORK_SAFETY_LIBRARY_ID,
    version: NETWORK_SAFETY_LIBRARY_VERSION,
    classify: classifyNetworkSafety,
    compare: compareNetworkSafety,
    envelope: (facts, envelopeOptions = {}) => buildNetworkSafetyEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
