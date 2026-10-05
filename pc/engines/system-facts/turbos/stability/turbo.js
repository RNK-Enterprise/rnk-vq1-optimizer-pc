/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * System-facts stability turbo. It measures volatility across a bounded
 * sequence of normalized snapshots. It is analysis-only and never applies a
 * setting, opens a socket, or delegates its algorithm to an engine library.
 */

export const SYSTEM_FACTS_STABILITY_TURBO_ID = 'system-facts.stability';
export const SYSTEM_FACTS_STABILITY_TURBO_VERSION = 1;
export const SYSTEM_FACTS_STABILITY_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const PRESSURE_VALUES = Object.freeze({
  normal: 0,
  elevated: 0.5,
  high: 1,
  unknown: 0.25
});
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, lower = 0, upper = 1) {
  return Math.min(upper, Math.max(lower, value));
}

function pressure(value) {
  return Object.prototype.hasOwnProperty.call(PRESSURE_VALUES, value)
    ? PRESSURE_VALUES[value]
    : PRESSURE_VALUES.unknown;
}

function percent(value) {
  return clamp(finite(value, 50) / 100);
}

function storagePressure(snapshot) {
  const values = Array.isArray(snapshot.storage)
    ? snapshot.storage.map((item) => finite(item?.usedPercent, 0) / 100)
    : EMPTY_ARRAY;
  return values.length === 0 ? 0 : Math.max(...values);
}

function meshCount(snapshot) {
  if (!Array.isArray(snapshot.network)) return 0;
  return snapshot.network.filter((item) => item?.mesh === true).length;
}

function validateSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Stability turbo snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Stability turbo requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu) || !isRecord(snapshot.memory) || !isRecord(snapshot.pressure)) {
    throw new TypeError('Stability turbo snapshot is missing normalized sections');
  }
  return snapshot;
}

function vector(snapshot) {
  const facts = validateSnapshot(snapshot);
  return Object.freeze([
    percent(facts.cpu.utilizationPercent),
    pressure(facts.pressure.cpu),
    percent(facts.memory.usedPercent),
    pressure(facts.pressure.memory),
    percent(facts.memory.swapUsedPercent),
    pressure(facts.pressure.swap),
    storagePressure(facts),
    pressure(facts.pressure.storage),
    clamp((Array.isArray(facts.gpus) ? facts.gpus.length : 0) / 4),
    clamp(meshCount(facts) / 4)
  ]);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values, average = mean(values)) {
  return mean(values.map((value) => (value - average) ** 2));
}

function standardDeviation(values) {
  return Math.sqrt(variance(values));
}

function transpose(vectors, index) {
  return vectors.map((item) => item[index]);
}

function dimensionVolatility(vectors) {
  return Object.freeze(vectors[0].map((_, index) => standardDeviation(transpose(vectors, index))));
}

function totalVolatility(volatility) {
  return mean(volatility);
}

function directionalTrend(vectors) {
  if (vectors.length < 2) return 0;
  const first = vectors[0];
  const last = vectors[vectors.length - 1];
  const deltas = last.map((value, index) => Math.abs(value - first[index]));
  return mean(deltas);
}

function trendDirection(vectors) {
  if (vectors.length < 2) return 'flat';
  const delta = mean(vectors[vectors.length - 1].map((value, index) => value - vectors[0][index]));
  if (delta > 0.05) return 'rising';
  if (delta < -0.05) return 'falling';
  return 'flat';
}

function scoreFor(volatility, trend, sampleCount) {
  const sampleConfidence = clamp(sampleCount / 8);
  const raw = 100 - ((volatility * 70) + (trend * 30));
  return Math.round(clamp(raw / 100) * sampleConfidence * 10000) / 100;
}

function stateFor(score) {
  if (score >= 80) return 'stable';
  if (score >= 55) return 'watch';
  return 'unstable';
}

function requireTrigger(trigger) {
  if (!SYSTEM_FACTS_STABILITY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported stability turbo trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Stability turbo windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Stability turbo minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Stability turbo clock must return a number');
  return timestamp;
}

function resultEnvelope(trigger, timestamp, sampleCount, minimumSamples) {
  return {
    protocolVersion: 1,
    turbo: SYSTEM_FACTS_STABILITY_TURBO_ID,
    turboVersion: SYSTEM_FACTS_STABILITY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount,
    minimumSamples,
    score: null,
    state: 'insufficient-data',
    trend: 'flat',
    volatility: null,
    dimensions: EMPTY_ARRAY,
    actions: EMPTY_ARRAY
  };
}

export function runStabilityTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Stability turbo samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now());
  if (selected.length < requiredSamples) {
    return Object.freeze(resultEnvelope(trigger, timestamp, selected.length, requiredSamples));
  }
  const vectors = selected.map(vector);
  const volatility = dimensionVolatility(vectors);
  const averageVolatility = totalVolatility(volatility);
  const trend = directionalTrend(vectors);
  const score = scoreFor(averageVolatility, trend, vectors.length);
  return Object.freeze({
    protocolVersion: 1,
    turbo: SYSTEM_FACTS_STABILITY_TURBO_ID,
    turboVersion: SYSTEM_FACTS_STABILITY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: vectors.length,
    minimumSamples: requiredSamples,
    score,
    state: stateFor(score),
    trend: trendDirection(vectors),
    volatility: Math.round(averageVolatility * 10000) / 10000,
    dimensions: volatility,
    actions: EMPTY_ARRAY
  });
}
