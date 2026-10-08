/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * GPU thermal-margin turbo. It measures bounded thermal headroom without
 * changing GPU policy, clocks, drivers, files, or opening transport.
 */

export const GPU_THERMAL_MARGIN_TURBO_ID = 'gpu-utilization.thermal-margin';
export const GPU_THERMAL_MARGIN_TURBO_VERSION = 1;
export const GPU_THERMAL_MARGIN_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function temperatureOf(value) {
  if (!Number.isFinite(value)) return Object.freeze({ value: null, invalid: false });
  return Object.freeze({ value, invalid: value < -50 || value > 150 });
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('GPU thermal-margin snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('GPU thermal-margin requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.gpus)) {
    throw new TypeError('GPU thermal-margin snapshot requires a GPU list');
  }
  return snapshot;
}

function evidenceOf(snapshot, criticalMargin, elevatedMargin, thermalLimit) {
  const source = requireSnapshot(snapshot);
  const temperatures = source.gpus.filter(isRecord).map((gpu) => temperatureOf(gpu.temperatureCelsius));
  const invalid = temperatures.some((item) => item.invalid);
  const usable = temperatures.map((item) => item.value).filter((value) => value !== null);
  if (invalid) return Object.freeze({ margin: null, state: 'invalid', invalid: true });
  if (usable.length === 0) return Object.freeze({ margin: null, state: 'unknown', invalid: false });
  const margin = thermalLimit - Math.max(...usable);
  let state = 'normal';
  if (margin <= criticalMargin) state = 'critical';
  else if (margin <= elevatedMargin) state = 'elevated';
  return Object.freeze({ margin, state, invalid: false });
}

function requireTrigger(trigger) {
  if (!GPU_THERMAL_MARGIN_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU thermal-margin trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('GPU thermal-margin windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('GPU thermal-margin minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireMargin(name, value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`GPU thermal-margin ${name} must be between 0 and 100`);
  }
  return value;
}

function requireThermalLimit(value) {
  if (!Number.isFinite(value) || value < 50 || value > 150) {
    throw new RangeError('GPU thermal-margin thermalLimit must be between 50 and 150');
  }
  return value;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`GPU thermal-margin ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function observed(evidence) {
  return evidence.filter((item) => ['critical', 'elevated', 'normal'].includes(item.state));
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  criticalCount, elevatedCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-thermal-evidence';
  if (observedCount === 0) return 'no-observation';
  if (criticalCount >= persistenceThreshold) return 'sustained-critical-thermal';
  if (elevatedCount >= persistenceThreshold) return 'sustained-elevated-thermal';
  return 'normal-thermal-margin';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-gpu-thermal-samples']);
  if (state === 'invalid-thermal-evidence') return Object.freeze(['review-gpu-temperature-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-gpu-thermal-observation']);
  if (state === 'sustained-critical-thermal') return Object.freeze(['hold-unapproved-gpu-policy', 'protect-thermal-headroom']);
  if (state === 'sustained-elevated-thermal') return Object.freeze(['observe-next-thermal-sample', 'review-thermal-headroom']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU thermal-margin clock must return a number');
  return timestamp;
}

export function runGpuThermalMarginTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  criticalMargin = 5,
  elevatedMargin = 15,
  thermalLimit = 85,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('GPU thermal-margin samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredCritical = requireMargin('criticalMargin', criticalMargin);
  const requiredElevated = requireMargin('elevatedMargin', elevatedMargin);
  if (requiredCritical > requiredElevated) {
    throw new RangeError('GPU thermal-margin criticalMargin must not exceed elevatedMargin');
  }
  const requiredLimit = requireThermalLimit(thermalLimit);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredCritical,
    requiredElevated, requiredLimit));
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalid).length;
  const criticalCount = evidence.filter((item) => item.state === 'critical').length;
  const elevatedCount = evidence.filter((item) => item.state === 'elevated').length;
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    criticalCount, elevatedCount, requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: GPU_THERMAL_MARGIN_TURBO_ID,
    turboVersion: GPU_THERMAL_MARGIN_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount,
    invalidCount,
    criticalCount,
    elevatedCount,
    criticalMargin: requiredCritical,
    elevatedMargin: requiredElevated,
    thermalLimit: requiredLimit,
    persistenceThreshold: requiredPersistence,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
