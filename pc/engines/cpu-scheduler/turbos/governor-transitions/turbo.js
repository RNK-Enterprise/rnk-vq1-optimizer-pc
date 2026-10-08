/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-scheduler governor-transitions turbo. It observes bounded governor
 * changes and load alignment without changing frequency or scheduler policy.
 */

export const CPU_SCHEDULER_GOVERNOR_TURBO_ID = 'cpu-scheduler.governor-transitions';
export const CPU_SCHEDULER_GOVERNOR_TURBO_VERSION = 1;
export const CPU_SCHEDULER_GOVERNOR_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const GOVERNORS = Object.freeze(['performance', 'powersave', 'schedutil']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedGovernor(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return GOVERNORS.includes(normalized) ? normalized : null;
}

function normalizedLoad(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('CPU-scheduler governor-transitions snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-scheduler governor-transitions requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-scheduler governor-transitions snapshot requires a CPU section');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const cpu = requireSnapshot(snapshot).cpu;
  return Object.freeze({
    governor: normalizedGovernor(cpu.governor),
    utilizationPercent: normalizedLoad(cpu.utilizationPercent)
  });
}

function requireTrigger(trigger) {
  if (!CPU_SCHEDULER_GOVERNOR_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-scheduler governor-transitions trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-scheduler governor-transitions windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-scheduler governor-transitions minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireTransitionThreshold(threshold) {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 64) {
    throw new RangeError('CPU-scheduler governor-transitions transitionThreshold must be an integer from 1 to 64');
  }
  return threshold;
}

function requireRateThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('CPU-scheduler governor-transitions transitionRateThreshold must be between 0 and 1');
  }
  return threshold;
}

function requireLoadThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError('CPU-scheduler governor-transitions loadThreshold must be between 0 and 100');
  }
  return threshold;
}

function requireCountThreshold(threshold) {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 64) {
    throw new RangeError('CPU-scheduler governor-transitions loadCountThreshold must be an integer from 1 to 64');
  }
  return threshold;
}

function transitions(evidence) {
  let count = 0;
  for (let index = 1; index < evidence.length; index += 1) {
    if (evidence[index].governor !== null && evidence[index - 1].governor !== null
      && evidence[index].governor !== evidence[index - 1].governor) {
      count += 1;
    }
  }
  return count;
}

function recognized(evidence) {
  return evidence.filter((item) => item.governor !== null);
}

function countGovernor(evidence, governor) {
  return evidence.filter((item) => item.governor === governor).length;
}

function countPowersaveUnderLoad(evidence, loadThreshold) {
  return evidence.filter((item) => item.governor === 'powersave'
    && item.utilizationPercent !== null && item.utilizationPercent >= loadThreshold).length;
}

function stateFor(sampleCount, minimumSamples, observedCount, powersaveUnderLoad,
  loadCountThreshold, transitionCount, transitionThreshold, transitionRate,
  transitionRateThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (powersaveUnderLoad >= loadCountThreshold) return 'powersave-under-load';
  if (transitionCount >= transitionThreshold) return 'frequent-transition';
  if (transitionRate >= transitionRateThreshold) return 'transition-watch';
  return 'stable-governor';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-governor-samples']);
  if (state === 'no-observation') return Object.freeze(['request-governor-observation']);
  if (state === 'powersave-under-load') return Object.freeze(['review-documented-governor-control']);
  if (state === 'frequent-transition') return Object.freeze(['observe-governor-transition-duration']);
  if (state === 'transition-watch') return Object.freeze(['observe-next-governor-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('CPU-scheduler governor-transitions clock must return a number');
  }
  return timestamp;
}

export function runCpuSchedulerGovernorTransitionsTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  transitionThreshold = 3,
  transitionRateThreshold = 0.5,
  loadThreshold = 65,
  loadCountThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-scheduler governor-transitions samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredTransitions = requireTransitionThreshold(transitionThreshold);
  const requiredRate = requireRateThreshold(transitionRateThreshold);
  const requiredLoad = requireLoadThreshold(loadThreshold);
  const requiredLoadCount = requireCountThreshold(loadCountThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const observed = recognized(evidence);
  const transitionCount = transitions(evidence);
  const powersaveUnderLoad = countPowersaveUnderLoad(evidence, requiredLoad);
  const transitionRate = observed.length < 2 ? 0 : transitionCount / (observed.length - 1);
  const state = stateFor(selected.length, requiredSamples, observed.length, powersaveUnderLoad,
    requiredLoadCount, transitionCount, requiredTransitions, transitionRate, requiredRate);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_SCHEDULER_GOVERNOR_TURBO_ID,
    turboVersion: CPU_SCHEDULER_GOVERNOR_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    transitionThreshold: requiredTransitions,
    transitionRateThreshold: requiredRate,
    loadThreshold: requiredLoad,
    loadCountThreshold: requiredLoadCount,
    observedCount: observed.length,
    unknownGovernorCount: evidence.length - observed.length,
    transitionCount,
    transitionRate: Math.round(transitionRate * 10000) / 10000,
    performanceCount: countGovernor(evidence, 'performance'),
    powersaveCount: countGovernor(evidence, 'powersave'),
    schedutilCount: countGovernor(evidence, 'schedutil'),
    powersaveUnderLoad,
    state,
    confidence: confidence(selected.length, observed.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
