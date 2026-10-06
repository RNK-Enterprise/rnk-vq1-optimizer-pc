/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Driver-capability library. It classifies documented driver evidence without
 * installing, replacing, loading, or changing drivers.
 */

export const DRIVER_CAPABILITY_LIBRARY_ID = 'driver-capability-library';
export const DRIVER_CAPABILITY_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EVIDENCE = Object.freeze(['documented', 'unverified', 'unknown']);

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
  if (!isRecord(facts)) throw new TypeError('Driver-capability library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Driver-capability library requires normalized system facts');
  }
  if (!Array.isArray(facts.drivers)) {
    throw new TypeError('Driver-capability library requires a driver list');
  }
  return facts;
}

function stateFor(environment, count, unverifiedCount, unknownCount) {
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

export function classifyDriverCapability(facts) {
  const source = requireFacts(facts);
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
    library: DRIVER_CAPABILITY_LIBRARY_ID,
    libraryVersion: DRIVER_CAPABILITY_LIBRARY_VERSION,
    environment,
    driverCount: drivers.length,
    names: Object.freeze(drivers.map((driver) => driver.name).filter(Boolean)),
    vendors: Object.freeze(drivers.map((driver) => driver.vendor).filter(Boolean)),
    versions: Object.freeze(drivers.map((driver) => driver.version).filter(Boolean)),
    evidenceStates: Object.freeze(drivers.map((driver) => driver.evidence)),
    documentedCount,
    unverifiedCount,
    unknownCount,
    supportedEvidence: EVIDENCE,
    state: stateFor(environment, drivers.length, unverifiedCount, unknownCount),
    confidence: confidence(environment, drivers.length, documentedCount, namedCount),
    recommendations: recommendations(environment, drivers.length, unverifiedCount, unknownCount)
  });
}

export function compareDriverCapability(previous, current) {
  const before = classifyDriverCapability(previous);
  const after = classifyDriverCapability(current);
  const stateChanged = before.state !== after.state;
  const countChanged = before.driverCount !== after.driverCount;
  const documentedChanged = before.documentedCount !== after.documentedCount;
  const unverifiedChanged = before.unverifiedCount !== after.unverifiedCount;
  const unknownChanged = before.unknownCount !== after.unknownCount;
  const namesChanged = before.names.join('|') !== after.names.join('|');
  const versionsChanged = before.versions.join('|') !== after.versions.join('|');
  return Object.freeze({
    changed: stateChanged || countChanged || documentedChanged || unverifiedChanged
      || unknownChanged || namesChanged || versionsChanged,
    stateChanged,
    countChanged,
    documentedChanged,
    unverifiedChanged,
    unknownChanged,
    namesChanged,
    versionsChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Driver-capability library clock must return a number');
  return timestamp;
}

export function buildDriverCapabilityEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Driver-capability library trigger is required');
  }
  return Object.freeze({
    library: DRIVER_CAPABILITY_LIBRARY_ID,
    libraryVersion: DRIVER_CAPABILITY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyDriverCapability(facts)
  });
}

export function createDriverCapabilityLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Driver-capability library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: DRIVER_CAPABILITY_LIBRARY_ID,
    version: DRIVER_CAPABILITY_LIBRARY_VERSION,
    classify: classifyDriverCapability,
    compare: compareDriverCapability,
    envelope: (facts, envelopeOptions = {}) => buildDriverCapabilityEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
