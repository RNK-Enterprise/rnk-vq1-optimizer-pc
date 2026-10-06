/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Thermal library. It classifies bounded temperature and headroom evidence
 * without changing fans, governors, workloads, or transport state.
 */

export const THERMAL_LIBRARY_ID = 'thermal-library';
export const THERMAL_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

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
  if (!isRecord(facts)) throw new TypeError('Thermal library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Thermal library requires normalized system facts');
  }
  if (!isRecord(facts.thermal)) throw new TypeError('Thermal library requires a thermal object');
  return facts;
}

function levelFor(temperature, critical) {
  if (temperature === null) return 'unknown';
  if (critical !== null && temperature >= critical) return 'critical';
  if (temperature >= 90) return 'high';
  if (temperature >= 75) return 'elevated';
  return 'normal';
}

function stateFor(environment, observation, level) {
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

export function classifyThermal(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const thermal = source.thermal;
  const temperature = nonNegative(thermal.temperatureCelsius);
  const critical = nonNegative(thermal.criticalCelsius);
  const fanPercent = percent(thermal.fanPercent);
  const level = levelFor(temperature, critical);
  const observation = source.capabilities?.thermalObservation !== false;
  return Object.freeze({
    library: THERMAL_LIBRARY_ID,
    libraryVersion: THERMAL_LIBRARY_VERSION,
    environment,
    temperatureCelsius: temperature,
    criticalCelsius: critical,
    fanPercent,
    thermalHeadroomCelsius: temperature === null || critical === null ? null : critical - temperature,
    level,
    observationEnabled: observation,
    state: stateFor(environment, observation, level),
    confidence: confidence(environment, temperature, critical, fanPercent),
    recommendations: recommendations(environment, observation, level)
  });
}

export function compareThermal(previous, current) {
  const before = classifyThermal(previous);
  const after = classifyThermal(current);
  const stateChanged = before.state !== after.state;
  const temperatureChanged = before.temperatureCelsius !== after.temperatureCelsius;
  const criticalChanged = before.criticalCelsius !== after.criticalCelsius;
  const fanChanged = before.fanPercent !== after.fanPercent;
  const levelChanged = before.level !== after.level;
  const observationChanged = before.observationEnabled !== after.observationEnabled;
  return Object.freeze({
    changed: stateChanged || temperatureChanged || criticalChanged || fanChanged
      || levelChanged || observationChanged,
    stateChanged,
    temperatureChanged,
    criticalChanged,
    fanChanged,
    levelChanged,
    observationChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Thermal library clock must return a number');
  return timestamp;
}

export function buildThermalEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Thermal library trigger is required');
  }
  return Object.freeze({
    library: THERMAL_LIBRARY_ID,
    libraryVersion: THERMAL_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyThermal(facts)
  });
}

export function createThermalLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Thermal library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: THERMAL_LIBRARY_ID,
    version: THERMAL_LIBRARY_VERSION,
    classify: classifyThermal,
    compare: compareThermal,
    envelope: (facts, envelopeOptions = {}) => buildThermalEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
