/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Battery library. It classifies bounded battery evidence without changing
 * charging, power policy, files, or transport state.
 */

export const BATTERY_LIBRARY_ID = 'battery-library';
export const BATTERY_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'failed']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function healthOf(value) {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  return HEALTH_STATES.includes(normalized) ? normalized : 'unknown';
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Battery library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Battery library requires normalized system facts');
  }
  if (!isRecord(facts.battery)) throw new TypeError('Battery library requires a battery object');
  return facts;
}

function stateFor(environment, observation, present, health, charge) {
  if (environment === 'unknown') return 'profile-required';
  if (present === false) return 'no-battery';
  if (observation === false) return 'observation-disabled';
  if (present === null || charge === null) return 'observation-required';
  if (health === 'failed') return 'protect-power';
  if (charge <= 10) return 'low-charge';
  if (health === 'degraded') return 'review-health';
  return 'observe';
}

function recommendations(environment, observation, present, health, charge) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (present === false) return Object.freeze(['keep-battery-controls-disabled']);
  if (observation === false) return Object.freeze(['keep-battery-observation-disabled']);
  if (present === null || charge === null) return Object.freeze(['request-battery-observation']);
  if (health === 'failed') return Object.freeze(['protect-power', 'request-user-approved-battery-review']);
  if (charge <= 10) return Object.freeze(['review-user-owned-power-policy']);
  if (health === 'degraded') return Object.freeze(['review-battery-health']);
  return Object.freeze(['no-change']);
}

function confidence(environment, present, charge, health) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (present !== null) score += 0.2;
  if (charge !== null) score += 0.4;
  if (health !== 'unknown') score += 0.2;
  return Math.round(score * 10000) / 10000;
}

export function classifyBattery(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const battery = source.battery;
  const present = booleanOrNull(battery.present);
  const charge = percent(battery.chargePercent);
  const health = healthOf(battery.health);
  const charging = booleanOrNull(battery.charging);
  const observation = source.capabilities?.batteryObservation !== false;
  return Object.freeze({
    library: BATTERY_LIBRARY_ID,
    libraryVersion: BATTERY_LIBRARY_VERSION,
    environment,
    present,
    chargePercent: charge,
    charging,
    health,
    observationEnabled: observation,
    state: stateFor(environment, observation, present, health, charge),
    confidence: confidence(environment, present, charge, health),
    recommendations: recommendations(environment, observation, present, health, charge)
  });
}

export function compareBattery(previous, current) {
  const before = classifyBattery(previous);
  const after = classifyBattery(current);
  const stateChanged = before.state !== after.state;
  const presentChanged = before.present !== after.present;
  const chargeChanged = before.chargePercent !== after.chargePercent;
  const chargingChanged = before.charging !== after.charging;
  const healthChanged = before.health !== after.health;
  const observationChanged = before.observationEnabled !== after.observationEnabled;
  return Object.freeze({
    changed: stateChanged || presentChanged || chargeChanged || chargingChanged
      || healthChanged || observationChanged,
    stateChanged,
    presentChanged,
    chargeChanged,
    chargingChanged,
    healthChanged,
    observationChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Battery library clock must return a number');
  return timestamp;
}

export function buildBatteryEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Battery library trigger is required');
  }
  return Object.freeze({
    library: BATTERY_LIBRARY_ID,
    libraryVersion: BATTERY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyBattery(facts)
  });
}

export function createBatteryLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Battery library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: BATTERY_LIBRARY_ID,
    version: BATTERY_LIBRARY_VERSION,
    classify: classifyBattery,
    compare: compareBattery,
    envelope: (facts, envelopeOptions = {}) => buildBatteryEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
