/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Swap pressure-dwell turbo. It measures bounded pressure persistence without
 * creating swap, changing swappiness, or opening transport.
 */

export const SWAP_PRESSURE_DWELL_TURBO_ID = 'swap.pressure-dwell';
export const SWAP_PRESSURE_DWELL_TURBO_VERSION = 1;
export const SWAP_PRESSURE_DWELL_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const STATES = Object.freeze(['none', 'normal', 'elevated', 'high', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  if (!Number.isFinite(value)) return Object.freeze({ value: null, invalid: false });
  return Object.freeze({ value: Math.max(0, value), invalid: value < 0 });
}

function percentOf(value) {
  if (!Number.isFinite(value)) return Object.freeze({ value: null, invalid: false });
  return Object.freeze({
    value: Math.min(100, Math.max(0, value)),
    invalid: value < 0 || value > 100
  });
}

function stateFor(totalBytes, usedPercent) {
  if (totalBytes === 0) return 'none';
  if (totalBytes === null || usedPercent === null) return 'unknown';
  if (usedPercent >= 75) return 'high';
  if (usedPercent >= 40) return 'elevated';
  return 'normal';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Swap pressure-dwell snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Swap pressure-dwell requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.memory)) {
    throw new TypeError('Swap pressure-dwell snapshot requires a memory section');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const total = nonNegative(source.memory.swapTotalBytes);
  const used = percentOf(source.memory.swapUsedPercent);
  return Object.freeze({
    state: stateFor(total.value, used.value),
    invalid: total.invalid || used.invalid
  });
}

function requireTrigger(trigger) {
  if (!SWAP_PRESSURE_DWELL_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported swap pressure-dwell trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('Swap pressure-dwell windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Swap pressure-dwell minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Swap pressure-dwell ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => STATES.includes(item.state) && item.state !== 'unknown' && !item.invalid);
}

function stateForReport(sampleCount, minimumSamples, observedCount, invalidCount,
  highCount, elevatedCount, dwellThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-pressure-evidence';
  if (observedCount === 0) return 'no-observation';
  if (highCount >= dwellThreshold) return 'sustained-high';
  if (elevatedCount >= dwellThreshold) return 'sustained-elevated';
  return 'transient-or-normal';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-swap-pressure-samples']);
  if (state === 'invalid-pressure-evidence') return Object.freeze(['review-swap-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-swap-observation']);
  if (state === 'sustained-high') return Object.freeze(['hold-destructive-actions', 'review-memory-pressure']);
  if (state === 'sustained-elevated') return Object.freeze(['observe-next-swap-sample', 'review-documented-swap-policy']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Swap pressure-dwell clock must return a number');
  return timestamp;
}

export function runSwapPressureDwellTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  dwellThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Swap pressure-dwell samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredDwell = requireCount('dwellThreshold', dwellThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const highCount = evidence.filter((item) => item.state === 'high' && !item.invalid).length;
  const elevatedCount = evidence.filter((item) => item.state === 'elevated' && !item.invalid).length;
  const state = stateForReport(selected.length, requiredSamples, usable.length, invalidCount,
    highCount, elevatedCount, requiredDwell);
  return Object.freeze({
    protocolVersion: 1,
    turbo: SWAP_PRESSURE_DWELL_TURBO_ID,
    turboVersion: SWAP_PRESSURE_DWELL_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount,
    invalidCount,
    highCount,
    elevatedCount,
    dwellThreshold: requiredDwell,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
