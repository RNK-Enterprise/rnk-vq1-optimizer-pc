/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * CPU-frequency load-governor-mismatch turbo. It compares normalized load
 * with governor evidence without changing policy or writing system files.
 */

export const CPU_FREQUENCY_LOAD_TURBO_ID = 'cpu-frequency.load-governor-mismatch';
export const CPU_FREQUENCY_LOAD_TURBO_VERSION = 1;
export const CPU_FREQUENCY_LOAD_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const GOVERNORS = Object.freeze(['performance', 'powersave', 'schedutil']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function governorOf(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return GOVERNORS.includes(normalized) ? normalized : null;
}

function loadOf(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('CPU-frequency load-governor-mismatch snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-frequency load-governor-mismatch requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-frequency load-governor-mismatch snapshot requires a CPU section');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const cpu = requireSnapshot(snapshot).cpu;
  const governor = governorOf(cpu.governor);
  const utilizationPercent = loadOf(cpu.utilizationPercent);
  const powersaveUnderLoad = governor === 'powersave' && utilizationPercent !== null
    && utilizationPercent >= 65;
  const performanceUnderIdle = governor === 'performance' && utilizationPercent !== null
    && utilizationPercent <= 25;
  return Object.freeze({ governor, utilizationPercent, powersaveUnderLoad, performanceUnderIdle });
}

function requireTrigger(trigger) {
  if (!CPU_FREQUENCY_LOAD_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-frequency load-governor-mismatch trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-frequency load-governor-mismatch windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-frequency load-governor-mismatch minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCountThreshold(threshold) {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 64) {
    throw new RangeError('CPU-frequency load-governor-mismatch mismatchCountThreshold must be an integer from 1 to 64');
  }
  return threshold;
}

function requireRateThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('CPU-frequency load-governor-mismatch mismatchRateThreshold must be between 0 and 1');
  }
  return threshold;
}

function observed(evidence) {
  return evidence.filter((item) => item.governor !== null && item.utilizationPercent !== null);
}

function stateFor(sampleCount, minimumSamples, observedCount, powersaveCount,
  performanceCount, mismatchRate, mismatchRateThreshold, mismatchCountThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (powersaveCount >= mismatchCountThreshold) return 'powersave-under-load';
  if (performanceCount >= mismatchCountThreshold) return 'performance-under-idle';
  if (mismatchRate >= mismatchRateThreshold) return 'mismatch-burst';
  return 'aligned-window';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-frequency-samples']);
  if (state === 'no-observation') return Object.freeze(['request-load-governor-observation']);
  if (state === 'powersave-under-load') return Object.freeze(['review-documented-frequency-control']);
  if (state === 'performance-under-idle') return Object.freeze(['review-idle-frequency-control']);
  if (state === 'mismatch-burst') return Object.freeze(['observe-load-governor-alignment']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('CPU-frequency load-governor-mismatch clock must return a number');
  return timestamp;
}

export function runCpuFrequencyLoadGovernorMismatchTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  mismatchCountThreshold = 2,
  mismatchRateThreshold = 0.5,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-frequency load-governor-mismatch samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredCount = requireCountThreshold(mismatchCountThreshold);
  const requiredRate = requireRateThreshold(mismatchRateThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usable = observed(evidence);
  const powersaveUnderLoadCount = evidence.filter((item) => item.powersaveUnderLoad).length;
  const performanceUnderIdleCount = evidence.filter((item) => item.performanceUnderIdle).length;
  const mismatchRate = selected.length === 0 ? 0
    : (powersaveUnderLoadCount + performanceUnderIdleCount) / selected.length;
  const state = stateFor(selected.length, requiredSamples, usable.length, powersaveUnderLoadCount,
    performanceUnderIdleCount, mismatchRate, requiredRate, requiredCount);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_FREQUENCY_LOAD_TURBO_ID,
    turboVersion: CPU_FREQUENCY_LOAD_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    mismatchCountThreshold: requiredCount,
    mismatchRateThreshold: requiredRate,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length,
    powersaveUnderLoadCount,
    performanceUnderIdleCount,
    mismatchRate: Math.round(mismatchRate * 10000) / 10000,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
