/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Thermal engine. It classifies bounded temperature and thermal-headroom
 * evidence without changing fans, governors, workloads, or transport state.
 */

export const THERMAL_ENGINE_ID = 'thermal';
export const THERMAL_ENGINE_VERSION = 1;
export const THERMAL_TRIGGERS = Object.freeze([
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

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Thermal facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Thermal requires system-facts facts');
  if (!isRecord(facts.thermal)) throw new TypeError('Thermal facts require a thermal object');
  return facts;
}

function requireTrigger(trigger) {
  if (!THERMAL_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported thermal trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Thermal clock must return a number');
  return timestamp;
}

function levelFor(temperature, critical) {
  if (temperature === null) return 'unknown';
  if (critical !== null && temperature >= critical) return 'critical';
  if (temperature >= 90) return 'high';
  if (temperature >= 75) return 'elevated';
  return 'normal';
}

function operatingState(environment, observation, level) {
  if (environment === 'unknown') return 'profile-required';
  if (observation === false) return 'observation-disabled';
  if (level === 'unknown') return 'observation-required';
  if (level === 'critical' && environment === 'headless') return 'protect-services';
  if (level === 'critical') return 'protect-foreground';
  if (level === 'high' && environment === 'headless') return 'protect-services';
  if (level === 'high') return 'protect-foreground';
  if (level === 'elevated') return 'watch';
  return 'observe';
}

function recommendations(environment, observation, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (observation === false) return Object.freeze(['keep-thermal-observation-disabled']);
  if (level === 'unknown') return Object.freeze(['request-thermal-observation']);
  if (level === 'critical' && environment === 'headless') {
    return Object.freeze(['protect-services', 'request-user-approved-thermal-response']);
  }
  if (level === 'critical') {
    return Object.freeze(['protect-foreground', 'request-user-approved-thermal-response']);
  }
  if (level === 'high') return Object.freeze(['protect-thermal-headroom']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample', 'review-thermal-headroom']);
  return Object.freeze(['no-change']);
}

function confidence(environment, temperature, critical, fanPercent) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (temperature !== null) score += 0.4;
  if (critical !== null) score += 0.2;
  if (fanPercent !== null) score += 0.2;
  return Math.round(score * 10000) / 10000;
}

export function runThermalEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const thermal = source.thermal;
  const temperature = nonNegative(thermal.temperatureCelsius);
  const critical = nonNegative(thermal.criticalCelsius);
  const fanPercent = percent(thermal.fanPercent);
  const level = levelFor(temperature, critical);
  const observation = source.capabilities?.thermalObservation !== false;
  return Object.freeze({
    protocolVersion: 1,
    engine: THERMAL_ENGINE_ID,
    engineVersion: THERMAL_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    temperatureCelsius: temperature,
    criticalCelsius: critical,
    fanPercent,
    thermalHeadroomCelsius: temperature === null || critical === null ? null : critical - temperature,
    level,
    observationEnabled: observation,
    state: operatingState(environment, observation, level),
    confidence: confidence(environment, temperature, critical, fanPercent),
    recommendations: recommendations(environment, observation, level),
    actions: EMPTY_ARRAY
  });
}
