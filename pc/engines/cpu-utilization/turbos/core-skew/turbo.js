/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-utilization core-skew turbo. It measures per-core imbalance and
 * dominant-core migration from bounded snapshots without changing affinity.
 */

export const CPU_UTILIZATION_CORE_SKEW_TURBO_ID = 'cpu-utilization.core-skew';
export const CPU_UTILIZATION_CORE_SKEW_TURBO_VERSION = 1;
export const CPU_UTILIZATION_CORE_SKEW_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function utilizationOf(value) {
  if (!Number.isFinite(value)) return null;
  return clamp(value, 0, 100);
}

function requireTrigger(trigger) {
  if (!CPU_UTILIZATION_CORE_SKEW_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-utilization core-skew trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-utilization core-skew windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-utilization core-skew minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(threshold, label) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError(`CPU-utilization core-skew ${label} must be between 0 and 100`);
  }
  return threshold;
}

function requireMigrationThreshold(threshold) {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 64) {
    throw new RangeError('CPU-utilization core-skew migrationThreshold must be an integer from 1 to 64');
  }
  return threshold;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('CPU-utilization core-skew snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-utilization core-skew requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-utilization core-skew snapshot requires a CPU section');
  }
  return snapshot;
}

function coreValues(snapshot) {
  const cores = Array.isArray(snapshot.cpu.cores) ? snapshot.cpu.cores : EMPTY_ARRAY;
  return cores.map((core) => utilizationOf(core?.utilizationPercent));
}

function summarize(values, overloadedThreshold) {
  const observed = values.filter((value) => value !== null);
  if (observed.length === 0) return { skew: null, dominant: null, overloaded: 0 };
  const maximum = Math.max(...observed);
  const minimum = Math.min(...observed);
  const dominant = values.indexOf(maximum);
  const overloaded = observed.filter((value) => value >= overloadedThreshold).length;
  return { skew: maximum - minimum, dominant, overloaded };
}

function average(values) {
  const observed = values.filter((value) => value !== null);
  return observed.length === 0 ? null : observed.reduce((sum, value) => sum + value, 0) / observed.length;
}

function maximum(values) {
  const observed = values.filter((value) => value !== null);
  return observed.length === 0 ? null : Math.max(...observed);
}

function migrationCount(summaries) {
  let changes = 0;
  for (let index = 1; index < summaries.length; index += 1) {
    const previous = summaries[index - 1].dominant;
    const current = summaries[index].dominant;
    if (previous !== null && current !== null && previous !== current) changes += 1;
  }
  return changes;
}

function stateFor(sampleCount, minimumSamples, observedCount, averageSkew, migrations, migrationThreshold, skewThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (averageSkew !== null && averageSkew >= skewThreshold) return 'high-skew';
  if (migrations >= migrationThreshold) return 'migration-watch';
  return 'balanced';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-core-samples']);
  if (state === 'no-observation') return Object.freeze(['request-core-utilization-observation']);
  if (state === 'high-skew') return Object.freeze(['review-core-contention', 'hold-affinity-change']);
  if (state === 'migration-watch') return Object.freeze(['observe-dominant-core-migration']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('CPU-utilization core-skew clock must return a number');
  return timestamp;
}

export function runCpuUtilizationCoreSkewTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  skewThreshold = 25,
  overloadedThreshold = 85,
  migrationThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('CPU-utilization core-skew samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const skewLimit = requireThreshold(skewThreshold, 'skewThreshold');
  const overloadedLimit = requireThreshold(overloadedThreshold, 'overloadedThreshold');
  const migrationLimit = requireMigrationThreshold(migrationThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const summaries = selected.map((snapshot) => summarize(coreValues(requireSnapshot(snapshot)), overloadedLimit));
  const skews = summaries.map((summary) => summary.skew);
  const observedCount = skews.filter((value) => value !== null).length;
  const averageSkew = average(skews);
  const migrations = migrationCount(summaries);
  const overloadedCoreSamples = summaries.reduce((sum, summary) => sum + summary.overloaded, 0);
  const state = stateFor(selected.length, requiredSamples, observedCount, averageSkew,
    migrations, migrationLimit, skewLimit);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_UTILIZATION_CORE_SKEW_TURBO_ID,
    turboVersion: CPU_UTILIZATION_CORE_SKEW_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    skewThreshold: skewLimit,
    overloadedThreshold: overloadedLimit,
    migrationThreshold: migrationLimit,
    observedCount,
    averageSkewPercent: averageSkew === null ? null : Math.round(averageSkew * 100) / 100,
    maximumSkewPercent: maximum(skews),
    dominantCoreChanges: migrations,
    overloadedCoreSamples,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
