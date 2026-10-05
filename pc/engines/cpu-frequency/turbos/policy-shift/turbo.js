/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-frequency policy-shift turbo. It observes bounded governor and driver
 * changes without changing frequency policy or writing system files.
 */

export const CPU_FREQUENCY_POLICY_TURBO_ID = 'cpu-frequency.policy-shift';
export const CPU_FREQUENCY_POLICY_TURBO_VERSION = 1;
export const CPU_FREQUENCY_POLICY_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const GOVERNORS = Object.freeze(['performance', 'powersave', 'schedutil']);
const DRIVERS = Object.freeze(['intel_pstate', 'amd_pstate', 'acpi-cpufreq']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalized(value, allowed) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  return allowed.includes(text) ? text : null;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('CPU-frequency policy-shift snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-frequency policy-shift requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-frequency policy-shift snapshot requires a CPU section');
  }
  return snapshot;
}

function evidenceOf(snapshot) {
  const cpu = requireSnapshot(snapshot).cpu;
  const rawGovernor = typeof cpu.governor === 'string' ? cpu.governor.trim().toLowerCase() : null;
  const rawDriver = typeof cpu.driver === 'string' ? cpu.driver.trim().toLowerCase() : null;
  const governor = normalized(cpu.governor, GOVERNORS);
  const driver = normalized(cpu.driver, DRIVERS);
  return Object.freeze({
    governor,
    driver,
    unsupported: (rawGovernor !== null && governor === null) || (rawDriver !== null && driver === null),
    signature: governor === null && driver === null ? null : `${governor || 'unknown'}:${driver || 'unknown'}`
  });
}

function requireTrigger(trigger) {
  if (!CPU_FREQUENCY_POLICY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-frequency policy-shift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-frequency policy-shift windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-frequency policy-shift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireChangeThreshold(threshold) {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 64) {
    throw new RangeError('CPU-frequency policy-shift changeThreshold must be an integer from 1 to 64');
  }
  return threshold;
}

function requireRateThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('CPU-frequency policy-shift changeRateThreshold must be between 0 and 1');
  }
  return threshold;
}

function observed(evidence) {
  return evidence.filter((item) => item.signature !== null);
}

function transitions(evidence) {
  let count = 0;
  let comparisons = 0;
  for (let index = 1; index < evidence.length; index += 1) {
    if (evidence[index].signature !== null && evidence[index - 1].signature !== null) {
      comparisons += 1;
      if (evidence[index].signature !== evidence[index - 1].signature) count += 1;
    }
  }
  return { count, comparisons };
}

function stateFor(sampleCount, minimumSamples, observedCount, unsupportedCount,
  changeCount, changeThreshold, changeRate, changeRateThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (unsupportedCount > 0) return 'unsupported-policy';
  if (changeCount >= changeThreshold) return 'frequent-shift';
  if (changeRate >= changeRateThreshold) return 'policy-watch';
  return 'stable-policy';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-frequency-samples']);
  if (state === 'no-observation') return Object.freeze(['request-frequency-policy-observation']);
  if (state === 'unsupported-policy') return Object.freeze(['review-undocumented-frequency-control']);
  if (state === 'frequent-shift') return Object.freeze(['observe-frequency-policy-duration']);
  if (state === 'policy-watch') return Object.freeze(['observe-next-frequency-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('CPU-frequency policy-shift clock must return a number');
  return timestamp;
}

export function runCpuFrequencyPolicyShiftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  changeThreshold = 3,
  changeRateThreshold = 0.5,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-frequency policy-shift samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredChanges = requireChangeThreshold(changeThreshold);
  const requiredRate = requireRateThreshold(changeRateThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usable = observed(evidence);
  const { count: changeCount, comparisons } = transitions(evidence);
  const unsupportedCount = evidence.filter((item) => item.unsupported).length;
  const changeRate = comparisons === 0 ? 0 : changeCount / comparisons;
  const state = stateFor(selected.length, requiredSamples, usable.length, unsupportedCount,
    changeCount, requiredChanges, changeRate, requiredRate);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_FREQUENCY_POLICY_TURBO_ID,
    turboVersion: CPU_FREQUENCY_POLICY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    changeThreshold: requiredChanges,
    changeRateThreshold: requiredRate,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length,
    unsupportedCount,
    comparisonCount: comparisons,
    changeCount,
    changeRate: Math.round(changeRate * 10000) / 10000,
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
