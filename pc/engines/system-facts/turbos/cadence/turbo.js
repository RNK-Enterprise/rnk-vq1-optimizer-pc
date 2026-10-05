/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * System-facts cadence turbo. It selects a bounded observation interval from
 * current pressure, recent volatility, host environment, trigger urgency,
 * and capability confidence. It never applies a setting or opens transport.
 */

export const SYSTEM_FACTS_CADENCE_TURBO_ID = 'system-facts.cadence';
export const SYSTEM_FACTS_CADENCE_TURBO_VERSION = 1;
export const SYSTEM_FACTS_CADENCE_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const PRESSURE_LEVELS = Object.freeze({ normal: 0.15, elevated: 0.6, high: 1, unknown: 0.35 });
const ENVIRONMENT_POLICY = Object.freeze({
  interactive: Object.freeze({ baseMs: 30000, minMs: 3000, maxMs: 120000 }),
  headless: Object.freeze({ baseMs: 60000, minMs: 5000, maxMs: 300000 }),
  unknown: Object.freeze({ baseMs: 15000, minMs: 5000, maxMs: 60000 })
});
const TRIGGER_FACTORS = Object.freeze({
  'install.preflight': 0.75,
  'system.facts.request': 1,
  'workload.changed': 0.45,
  'health.interval': 1.1
});
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, lower = 0, upper = 1) {
  return Math.min(upper, Math.max(lower, value));
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function percent(value, fallback = 0) {
  return clamp(finite(value, fallback) / 100);
}

function pressureValue(value) {
  return Object.prototype.hasOwnProperty.call(PRESSURE_LEVELS, value)
    ? PRESSURE_LEVELS[value]
    : PRESSURE_LEVELS.unknown;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Cadence turbo snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Cadence turbo requires a system-facts snapshot');
  if (!isRecord(snapshot.cpu) || !isRecord(snapshot.memory) || !isRecord(snapshot.pressure)) {
    throw new TypeError('Cadence turbo snapshot is missing normalized sections');
  }
  return snapshot;
}

function requireHistory(history) {
  if (!Array.isArray(history)) throw new TypeError('Cadence turbo history must be an array');
  if (!history.every(isRecord)) throw new TypeError('Cadence turbo history contains an invalid snapshot');
  return history.slice(-16);
}

function maxStorage(snapshot) {
  if (!Array.isArray(snapshot.storage) || snapshot.storage.length === 0) return null;
  return Math.max(...snapshot.storage.map((item) => percent(item?.usedPercent)));
}

function gpuPressure(snapshot) {
  if (!Array.isArray(snapshot.gpus) || snapshot.gpus.length === 0) return null;
  return Math.max(...snapshot.gpus.map((gpu) => Math.max(
    percent(gpu?.utilizationPercent),
    percent(gpu?.temperatureCelsius, 0) / 1.2
  )));
}

function resourceSignals(snapshot) {
  const storage = maxStorage(snapshot);
  const gpu = gpuPressure(snapshot);
  return Object.freeze({
    cpu: Math.max(percent(snapshot.cpu.utilizationPercent, 50), pressureValue(snapshot.pressure.cpu)),
    memory: Math.max(percent(snapshot.memory.usedPercent, 50), pressureValue(snapshot.pressure.memory)),
    swap: Math.max(percent(snapshot.memory.swapUsedPercent), pressureValue(snapshot.pressure.swap)),
    storage: Math.max(storage === null ? 0 : storage, pressureValue(snapshot.pressure.storage)),
    gpu: gpu === null ? null : gpu
  });
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pressureScore(signals) {
  const active = Object.values(signals).filter((value) => value !== null);
  return clamp(mean(active));
}

function pressureVector(snapshot) {
  const signals = resourceSignals(snapshot);
  return Object.values(signals).map((value) => value === null ? 0 : value);
}

function historyVolatility(history, current) {
  if (history.length === 0) return 0.5;
  const currentVector = pressureVector(current);
  const deltas = history.map((item) => mean(pressureVector(item).map((value, index) => (
    Math.abs(value - currentVector[index])
  ))));
  return clamp(mean(deltas) * 2);
}

function capabilityConfidence(snapshot) {
  const names = [
    'gpuObservation',
    'displayObservation',
    'thermalObservation',
    'powerProfileControl',
    'processPriorityControl',
    'ioPriorityControl',
    'cacheCleanup',
    'networkObservation'
  ];
  const capabilities = isRecord(snapshot.capabilities) ? snapshot.capabilities : {};
  const known = names.filter((name) => typeof capabilities[name] === 'boolean').length;
  return known === 0 ? 0.5 : known / names.length;
}

function environmentPolicy(environment) {
  return ENVIRONMENT_POLICY[environment] || ENVIRONMENT_POLICY.unknown;
}

function pressureFactor(score) {
  if (score >= 0.8) return 0.5;
  if (score >= 0.55) return 0.75;
  if (score <= 0.25) return 1.5;
  return 1;
}

function stabilityFactor(volatility) {
  if (volatility <= 0.2) return 1.35;
  if (volatility >= 0.7) return 0.75;
  return 1;
}

function confidenceFactor(confidence) {
  if (confidence < 0.5) return 0.8;
  if (confidence > 0.875) return 1.1;
  return 1;
}

function triggerFactor(trigger) {
  return TRIGGER_FACTORS[trigger];
}

function cadenceInterval(policy, factors) {
  const raw = policy.baseMs * factors.pressure * factors.stability
    * factors.confidence * factors.trigger;
  return Math.round(clamp(raw, policy.minMs, policy.maxMs));
}

function stateFor(score, volatility, trigger) {
  if (score >= 0.8) return 'urgent';
  if (trigger === 'workload.changed' || score >= 0.55) return 'responsive';
  if (volatility <= 0.2 && score <= 0.35) return 'relaxed';
  return 'balanced';
}

function boundaryFor(environment, state) {
  if (environment === 'unknown') return 'profile-selection-required';
  if (state === 'urgent') return 'manual-review-required';
  if (environment === 'headless') return 'headless-observation-only';
  return 'interactive-observation-only';
}

function recommendations(environment, state) {
  if (environment === 'unknown') {
    return Object.freeze(['request-environment-profile', 'use-conservative-cadence']);
  }
  if (state === 'urgent') return Object.freeze(['sample-again-soon', 'hold-destructive-actions']);
  if (state === 'responsive') {
    const target = environment === 'headless' ? 'protect-services' : 'protect-foreground';
    return Object.freeze([target, 'sample-again-soon']);
  }
  if (state === 'relaxed') return Object.freeze(['allow-longer-interval', 'keep-observation-only']);
  return Object.freeze(['observe-at-selected-cadence']);
}

function requireTrigger(trigger) {
  if (!SYSTEM_FACTS_CADENCE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported cadence turbo trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Cadence turbo clock must return a number');
  return timestamp;
}

function rounded(value) {
  return Math.round(value * 10000) / 10000;
}

export function runCadenceTurbo(snapshot, {
  trigger,
  history = EMPTY_ARRAY,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const facts = requireSnapshot(snapshot);
  const samples = requireHistory(history);
  const timestamp = requireClock(now());
  const signals = resourceSignals(facts);
  const score = pressureScore(signals);
  const volatility = historyVolatility(samples, facts);
  const confidence = capabilityConfidence(facts);
  const policy = environmentPolicy(facts.environment);
  const factors = Object.freeze({
    pressure: pressureFactor(score),
    stability: stabilityFactor(volatility),
    confidence: confidenceFactor(confidence),
    trigger: triggerFactor(trigger)
  });
  const state = stateFor(score, volatility, trigger);
  const intervalMs = cadenceInterval(policy, factors);
  return Object.freeze({
    protocolVersion: 1,
    turbo: SYSTEM_FACTS_CADENCE_TURBO_ID,
    turboVersion: SYSTEM_FACTS_CADENCE_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment: facts.environment,
    state,
    pressure: rounded(score),
    volatility: rounded(volatility),
    confidence: rounded(confidence),
    samples: samples.length,
    factors,
    schedule: Object.freeze({
      intervalMs,
      minimumMs: policy.minMs,
      maximumMs: policy.maxMs
    }),
    boundary: boundaryFor(facts.environment, state),
    recommendations: recommendations(facts.environment, state),
    actions: EMPTY_ARRAY
  });
}
