/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-frequency frequency-residency turbo. It classifies bounded frequency
 * residency evidence without changing policy, writing system files, or
 * opening transport.
 */

export const CPU_FREQUENCY_RESIDENCY_TURBO_ID = 'cpu-frequency.frequency-residency';
export const CPU_FREQUENCY_RESIDENCY_TURBO_VERSION = 1;
export const CPU_FREQUENCY_RESIDENCY_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const BANDS = Object.freeze(['low', 'base', 'boost', 'invalid', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function frequencyOf(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function utilizationOf(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('CPU-frequency frequency-residency snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-frequency frequency-residency requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-frequency frequency-residency snapshot requires a CPU section');
  }
  return snapshot;
}

function bandFor(ratio, lowResidencyRatio, boostResidencyRatio) {
  if (ratio === null) return 'unknown';
  if (ratio < lowResidencyRatio) return 'low';
  if (ratio > boostResidencyRatio) return 'boost';
  return 'base';
}

function loadClass(utilization, highUtilizationThreshold) {
  if (utilization === null) return 'unknown';
  return utilization >= highUtilizationThreshold ? 'high' : 'normal';
}

function evidenceOf(snapshot, lowResidencyRatio, boostResidencyRatio, highUtilizationThreshold) {
  const cpu = requireSnapshot(snapshot).cpu;
  const frequency = frequencyOf(cpu.frequencyMHz);
  const baseFrequency = frequencyOf(cpu.baseFrequencyMHz);
  const maximumFrequency = frequencyOf(cpu.maxFrequencyMHz);
  const reference = baseFrequency || maximumFrequency;
  const utilization = utilizationOf(cpu.utilizationPercent);
  const ratio = frequency === null || reference === null ? null : frequency / reference;
  const overMaximum = frequency !== null && maximumFrequency !== null && frequency > maximumFrequency;
  const band = overMaximum ? 'invalid' : bandFor(ratio, lowResidencyRatio, boostResidencyRatio);
  const load = loadClass(utilization, highUtilizationThreshold);
  return Object.freeze({
    frequency,
    baseFrequency,
    maximumFrequency,
    reference,
    utilization,
    ratio,
    band,
    load,
    lowUnderLoad: band === 'low' && load === 'high',
    boostObserved: band === 'boost'
  });
}

function requireTrigger(trigger) {
  if (!CPU_FREQUENCY_RESIDENCY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-frequency frequency-residency trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-frequency frequency-residency windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-frequency frequency-residency minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireRatio(name, ratio, lower, upper) {
  if (!Number.isFinite(ratio) || ratio < lower || ratio > upper) {
    throw new RangeError(`CPU-frequency frequency-residency ${name} must be between ${lower} and ${upper}`);
  }
  return ratio;
}

function requireCount(name, count) {
  if (!Number.isInteger(count) || count < 1 || count > 64) {
    throw new RangeError(`CPU-frequency frequency-residency ${name} must be an integer from 1 to 64`);
  }
  return count;
}

function requireUtilizationThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError('CPU-frequency frequency-residency highUtilizationThreshold must be between 0 and 100');
  }
  return threshold;
}

function observed(evidence) {
  return evidence.filter((item) => item.band !== 'unknown' && item.band !== 'invalid');
}

function transitions(evidence) {
  let count = 0;
  let comparisons = 0;
  for (let index = 1; index < evidence.length; index += 1) {
    const previous = evidence[index - 1].band;
    const current = evidence[index].band;
    if (previous !== 'unknown' && current !== 'unknown'
      && previous !== 'invalid' && current !== 'invalid') {
      comparisons += 1;
      if (previous !== current) count += 1;
    }
  }
  return { count, comparisons };
}

function averageRatio(evidence) {
  const ratios = evidence
    .filter((item) => item.band !== 'unknown' && item.band !== 'invalid' && item.ratio !== null)
    .map((item) => item.ratio);
  if (ratios.length === 0) return null;
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
  return Math.round((total / ratios.length) * 10000) / 10000;
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  lowUnderLoadCount, boostCount, transitionCount, lowCountThreshold,
  boostCountThreshold, transitionCountThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-frequency-evidence';
  if (observedCount === 0) return 'no-observation';
  if (lowUnderLoadCount >= lowCountThreshold) return 'low-residency-under-load';
  if (boostCount >= boostCountThreshold) return 'sustained-boost-residency';
  if (transitionCount >= transitionCountThreshold) return 'unstable-residency';
  return 'balanced-residency';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-frequency-samples']);
  if (state === 'invalid-frequency-evidence') return Object.freeze(['review-frequency-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-frequency-residency-observation']);
  if (state === 'low-residency-under-load') return Object.freeze(['review-documented-frequency-control']);
  if (state === 'sustained-boost-residency') return Object.freeze(['observe-boost-duration-and-thermal-state']);
  if (state === 'unstable-residency') return Object.freeze(['observe-frequency-residency-stability']);
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
    throw new TypeError('CPU-frequency frequency-residency clock must return a number');
  }
  return timestamp;
}

export function runCpuFrequencyResidencyTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  lowResidencyRatio = 0.75,
  boostResidencyRatio = 1.05,
  highUtilizationThreshold = 70,
  lowCountThreshold = 2,
  boostCountThreshold = 2,
  transitionCountThreshold = 3,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-frequency frequency-residency samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredLowRatio = requireRatio('lowResidencyRatio', lowResidencyRatio, 0, 1);
  const requiredBoostRatio = requireRatio('boostResidencyRatio', boostResidencyRatio, 1, 2);
  const requiredUtilization = requireUtilizationThreshold(highUtilizationThreshold);
  const requiredLowCount = requireCount('lowCountThreshold', lowCountThreshold);
  const requiredBoostCount = requireCount('boostCountThreshold', boostCountThreshold);
  const requiredTransitions = requireCount('transitionCountThreshold', transitionCountThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredLowRatio,
    requiredBoostRatio, requiredUtilization));
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.band === 'invalid').length;
  const lowUnderLoadCount = evidence.filter((item) => item.lowUnderLoad).length;
  const boostCount = evidence.filter((item) => item.boostObserved).length;
  const { count: transitionCount, comparisons } = transitions(evidence);
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    lowUnderLoadCount, boostCount, transitionCount, requiredLowCount,
    requiredBoostCount, requiredTransitions);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_FREQUENCY_RESIDENCY_TURBO_ID,
    turboVersion: CPU_FREQUENCY_RESIDENCY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount,
    invalidCount,
    lowResidencyRatio: requiredLowRatio,
    boostResidencyRatio: requiredBoostRatio,
    highUtilizationThreshold: requiredUtilization,
    lowUnderLoadCount,
    boostCount,
    comparisonCount: comparisons,
    transitionCount,
    averageRatio: averageRatio(evidence),
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}

export function cpuFrequencyResidencyBands() {
  return BANDS;
}
