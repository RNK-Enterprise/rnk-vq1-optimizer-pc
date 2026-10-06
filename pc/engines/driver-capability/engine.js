/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Driver-capability engine. It classifies documented driver evidence without
 * installing, replacing, loading, or changing drivers.
 */

export const DRIVER_CAPABILITY_ENGINE_ID = 'driver-capability';
export const DRIVER_CAPABILITY_ENGINE_VERSION = 1;
export const DRIVER_CAPABILITY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EVIDENCE = Object.freeze(['documented', 'unverified', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function evidenceOf(driver) {
  if (driver.documented === true) return 'documented';
  if (driver.documented === false) return 'unverified';
  return 'unknown';
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Driver-capability facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Driver-capability requires system-facts facts');
  if (!Array.isArray(facts.drivers)) throw new TypeError('Driver-capability facts require a driver list');
  return facts;
}

function requireTrigger(trigger) {
  if (!DRIVER_CAPABILITY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported driver-capability trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Driver-capability clock must return a number');
  return timestamp;
}

function operatingState(environment, count, unverifiedCount, unknownCount) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-drivers';
  if (unverifiedCount > 0) return 'review-required';
  if (unknownCount > 0) return 'observation-required';
  return 'observe';
}

function recommendations(environment, count, unverifiedCount, unknownCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-driver-capability-review']);
  if (unverifiedCount > 0) return Object.freeze(['review-driver-source-without-change']);
  if (unknownCount > 0) return Object.freeze(['request-driver-capability-observation']);
  return Object.freeze(['no-change']);
}

function confidence(environment, count, documentedCount, namedCount) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (count > 0) score += 0.2;
  if (count > 0 && documentedCount === count) score += 0.3;
  if (count > 0 && namedCount === count) score += 0.3;
  return Math.round(score * 10000) / 10000;
}

export function runDriverCapabilityEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const drivers = source.drivers.filter(isRecord).map((driver) => ({
    name: text(driver.name),
    vendor: text(driver.vendor),
    version: text(driver.version),
    evidence: evidenceOf(driver)
  }));
  const documentedCount = drivers.filter((driver) => driver.evidence === 'documented').length;
  const unverifiedCount = drivers.filter((driver) => driver.evidence === 'unverified').length;
  const unknownCount = drivers.filter((driver) => driver.evidence === 'unknown').length;
  const namedCount = drivers.filter((driver) => driver.name !== null).length;
  return Object.freeze({
    protocolVersion: 1,
    engine: DRIVER_CAPABILITY_ENGINE_ID,
    engineVersion: DRIVER_CAPABILITY_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    driverCount: drivers.length,
    names: Object.freeze(drivers.map((driver) => driver.name).filter(Boolean)),
    vendors: Object.freeze(drivers.map((driver) => driver.vendor).filter(Boolean)),
    versions: Object.freeze(drivers.map((driver) => driver.version).filter(Boolean)),
    evidenceStates: Object.freeze(drivers.map((driver) => driver.evidence)),
    documentedCount,
    unverifiedCount,
    unknownCount,
    supportedEvidence: Object.freeze(EVIDENCE),
    state: operatingState(environment, drivers.length, unverifiedCount, unknownCount),
    confidence: confidence(environment, drivers.length, documentedCount, namedCount),
    recommendations: recommendations(environment, drivers.length, unverifiedCount, unknownCount),
    actions: EMPTY_ARRAY
  });
}
