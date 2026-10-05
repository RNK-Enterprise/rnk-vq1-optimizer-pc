/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-utilization saturation-guard turbo. It detects sustained saturation and
 * recovery transitions from bounded snapshots without changing CPU policy.
 */

export const CPU_UTILIZATION_SATURATION_TURBO_ID = 'cpu-utilization.saturation-guard';
export const CPU_UTILIZATION_SATURATION_TURBO_VERSION = 1;
export const CPU_UTILIZATION_SATURATION_TRIGGERS = Object.freeze([
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
  if (!CPU_UTILIZATION_SATURATION_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-utilization saturation-guard trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-utilization saturation-guard windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-utilization saturation-guard minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireThreshold(threshold, label) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError(`CPU-utilization saturation-guard ${label} must be between 0 and 100`);
  }
  return threshold;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('CPU-utilization saturation-guard snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-utilization saturation-guard requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-utilization saturation-guard snapshot requires a CPU section');
  }
  return snapshot;
}

function valuesFor(samples) {
  return samples.map((snapshot) => utilizationOf(requireSnapshot(snapshot).cpu.utilizationPercent));
}

function longestRun(values, threshold) {
  let current = 0;
  let longest = 0;
  values.forEach((value) => {
    if (value !== null && value >= threshold) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  });
  return longest;
}

function trailingRun(values, threshold) {
  let run = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== null && values[index] >= threshold) run += 1;
    else break;
  }
  return run;
}

function saturationCount(values, threshold) {
  return values.filter((value) => value !== null && value >= threshold).length;
}

function recoveryTransitions(values, saturationThreshold, recoveryThreshold) {
  let transitions = 0;
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous !== null && current !== null
      && previous >= saturationThreshold && current <= recoveryThreshold) {
      transitions += 1;
    }
  }
  return transitions;
}

function stateFor(sampleCount, minimumSamples, observedCount, longest, transitions, count) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (observedCount === 0) return 'no-observation';
  if (longest >= minimumSamples) return 'sustained-saturation';
  if (transitions > 0) return 'recovery-observed';
  if (count > 0) return 'intermittent-saturation';
  return 'clear';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cpu-samples']);
  if (state === 'no-observation') return Object.freeze(['request-cpu-utilization-observation']);
  if (state === 'sustained-saturation') return Object.freeze(['protect-foreground', 'hold-unapproved-policy-change']);
  if (state === 'recovery-observed') return Object.freeze(['observe-recovery-window']);
  if (state === 'intermittent-saturation') return Object.freeze(['observe-next-cpu-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('CPU-utilization saturation-guard clock must return a number');
  }
  return timestamp;
}

export function runCpuUtilizationSaturationGuardTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 3,
  saturationThreshold = 85,
  recoveryThreshold = 60,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-utilization saturation-guard samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const highThreshold = requireThreshold(saturationThreshold, 'saturationThreshold');
  const lowThreshold = requireThreshold(recoveryThreshold, 'recoveryThreshold');
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const values = valuesFor(selected);
  const observedCount = values.filter((value) => value !== null).length;
  const count = saturationCount(values, highThreshold);
  const longest = longestRun(values, highThreshold);
  const trailing = trailingRun(values, highThreshold);
  const transitions = recoveryTransitions(values, highThreshold, lowThreshold);
  const state = stateFor(selected.length, requiredSamples, observedCount, longest, transitions, count);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_UTILIZATION_SATURATION_TURBO_ID,
    turboVersion: CPU_UTILIZATION_SATURATION_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    saturationThreshold: highThreshold,
    recoveryThreshold: lowThreshold,
    observedCount,
    saturationCount: count,
    longestSaturationRun: longest,
    trailingSaturationRun: trailing,
    recoveryTransitions: transitions,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
