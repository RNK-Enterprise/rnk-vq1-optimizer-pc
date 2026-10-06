/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * System-facts pressure turbo. It converts normalized resource observations
 * into a weighted pressure score. It is analysis-only and has no operating
 * system, filesystem, or transport side effects.
 */

export const SYSTEM_FACTS_PRESSURE_TURBO_ID = 'system-facts.pressure';
export const SYSTEM_FACTS_PRESSURE_TURBO_VERSION = 1;
export const SYSTEM_FACTS_PRESSURE_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const PRESSURE_LEVELS = Object.freeze({ normal: 0.15, elevated: 0.6, high: 1, unknown: 0.35 });
const WEIGHTS = Object.freeze({ cpu: 0.3, memory: 0.3, swap: 0.15, storage: 0.15, gpu: 0.1 });
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, lower = 0, upper = 1) {
  return Math.min(upper, Math.max(lower, value));
}

function pressureValue(value) {
  return Object.prototype.hasOwnProperty.call(PRESSURE_LEVELS, value)
    ? PRESSURE_LEVELS[value]
    : PRESSURE_LEVELS.unknown;
}

function percent(value, fallback = 0) {
  return clamp((Number.isFinite(value) ? value : fallback) / 100);
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Pressure turbo snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Pressure turbo requires a system-facts snapshot');
  if (!isRecord(snapshot.cpu) || !isRecord(snapshot.memory) || !isRecord(snapshot.pressure)) {
    throw new TypeError('Pressure turbo snapshot is missing normalized sections');
  }
  return snapshot;
}

function maxStorage(snapshot) {
  if (!Array.isArray(snapshot.storage) || snapshot.storage.length === 0) return null;
  return Math.max(...snapshot.storage.map((item) => percent(item?.usedPercent)));
}

function gpuSignal(snapshot) {
  if (!Array.isArray(snapshot.gpus) || snapshot.gpus.length === 0) return null;
  const values = snapshot.gpus.map((gpu) => Math.max(
    percent(gpu?.utilizationPercent),
    percent(gpu?.temperatureCelsius, 0) / 1.2
  ));
  return Math.min(1, Math.max(...values));
}

function signals(snapshot) {
  const storage = maxStorage(snapshot);
  const gpu = gpuSignal(snapshot);
  return Object.freeze({
    cpu: Math.max(percent(snapshot.cpu.utilizationPercent, 50), pressureValue(snapshot.pressure.cpu)),
    memory: Math.max(percent(snapshot.memory.usedPercent, 50), pressureValue(snapshot.pressure.memory)),
    swap: Math.max(percent(snapshot.memory.swapUsedPercent, 0), pressureValue(snapshot.pressure.swap)),
    storage: Math.max(storage === null ? 0 : storage, pressureValue(snapshot.pressure.storage)),
    gpu: gpu === null ? null : gpu
  });
}

function activeWeights(signal) {
  const entries = Object.entries(WEIGHTS).filter(([name]) => name !== 'gpu' || signal.gpu !== null);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  return Object.freeze(Object.fromEntries(entries.map(([name, weight]) => [name, weight / total])));
}

function weightedScore(signal) {
  const weights = activeWeights(signal);
  return Object.keys(weights).reduce((sum, name) => sum + (signal[name] * weights[name]), 0);
}

function dominantSignal(signal) {
  const entries = Object.entries(signal).filter(([, value]) => value !== null);
  return entries.sort((left, right) => right[1] - left[1])[0][0];
}

function headroom(signal) {
  return Object.freeze(Object.fromEntries(
    Object.entries(signal)
      .filter(([, value]) => value !== null)
      .map(([name, value]) => [name, rounded(1 - value)])
  ));
}

function pressureConfidence(snapshot) {
  const pressureFields = ['cpu', 'memory', 'swap', 'storage'];
  const known = pressureFields.filter((name) => snapshot.pressure[name] !== 'unknown').length;
  const gpuKnown = Array.isArray(snapshot.gpus) && snapshot.gpus.length > 0;
  return rounded((known / pressureFields.length) * 0.75 + (gpuKnown ? 0.25 : 0.15));
}

function classification(score) {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'elevated';
  return 'normal';
}

function operatingState(snapshot, level) {
  if (snapshot.environment === 'unknown') return 'profile-required';
  if (snapshot.environment === 'headless' && level === 'high') return 'protect-services';
  if (level === 'high') return 'protect-foreground';
  if (level === 'elevated') return 'watch';
  return 'observe';
}

function recommendations(snapshot, level, dominant) {
  if (snapshot.environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (level === 'high' && snapshot.environment === 'headless') {
    return Object.freeze(['protect-services', `inspect-${dominant}-pressure`, 'hold-destructive-actions']);
  }
  if (level === 'high') {
    return Object.freeze(['protect-foreground', `inspect-${dominant}-pressure`, 'hold-destructive-actions']);
  }
  if (level === 'elevated') return Object.freeze(['observe-next-sample', `inspect-${dominant}-pressure`]);
  return Object.freeze(['no-change']);
}

function requireTrigger(trigger) {
  if (!SYSTEM_FACTS_PRESSURE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported pressure turbo trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Pressure turbo clock must return a number');
  return timestamp;
}

function rounded(value) {
  return Math.round(value * 10000) / 10000;
}

export function runPressureTurbo(snapshot, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const facts = requireSnapshot(snapshot);
  const timestamp = requireClock(now());
  const signal = signals(facts);
  const weights = activeWeights(signal);
  const score = weightedScore(signal);
  const level = classification(score);
  const dominant = dominantSignal(signal);
  return Object.freeze({
    protocolVersion: 1,
    turbo: SYSTEM_FACTS_PRESSURE_TURBO_ID,
    turboVersion: SYSTEM_FACTS_PRESSURE_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    score: rounded(score * 100),
    level,
    state: operatingState(facts, level),
    dominant,
    confidence: pressureConfidence(facts),
    signals: Object.freeze(Object.fromEntries(
      Object.entries(signal).map(([name, value]) => [name, value === null ? null : rounded(value)])
    )),
    headroom: headroom(signal),
    weighting: weights,
    recommendations: recommendations(facts, level, dominant),
    actions: EMPTY_ARRAY
  });
}
