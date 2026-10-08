/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Battery engine. It classifies bounded battery presence and health evidence
 * without changing charging, power, files, or transport state.
 */

export const BATTERY_ENGINE_ID = 'battery';
export const BATTERY_ENGINE_VERSION = 1;
export const BATTERY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'failed']);
const EMPTY_ARRAY = Object.freeze([]);

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
  if (!isRecord(facts)) throw new TypeError('Battery facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Battery requires system-facts facts');
  if (!isRecord(facts.battery)) throw new TypeError('Battery facts require a battery object');
  return facts;
}

function requireTrigger(trigger) {
  if (!BATTERY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported battery trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Battery clock must return a number');
  return timestamp;
}

function operatingState(environment, observation, present, health, charge) {
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

export function runBatteryEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const battery = source.battery;
  const present = booleanOrNull(battery.present);
  const charge = percent(battery.chargePercent);
  const health = healthOf(battery.health);
  const charging = booleanOrNull(battery.charging);
  const observation = source.capabilities?.batteryObservation !== false;
  return Object.freeze({
    protocolVersion: 1,
    engine: BATTERY_ENGINE_ID,
    engineVersion: BATTERY_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    present,
    chargePercent: charge,
    charging,
    health,
    observationEnabled: observation,
    state: operatingState(environment, observation, present, health, charge),
    confidence: confidence(environment, present, charge, health),
    recommendations: recommendations(environment, observation, present, health, charge),
    actions: EMPTY_ARRAY
  });
}
