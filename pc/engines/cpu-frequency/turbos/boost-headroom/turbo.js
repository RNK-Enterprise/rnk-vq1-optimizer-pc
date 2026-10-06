/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * CPU-frequency boost-headroom turbo. It measures bounded requested versus
 * observed frequency headroom without changing policy or writing system data.
 */

export const CPU_FREQUENCY_HEADROOM_TURBO_ID = 'cpu-frequency.boost-headroom';
export const CPU_FREQUENCY_HEADROOM_TURBO_VERSION = 1;
export const CPU_FREQUENCY_HEADROOM_TRIGGERS = Object.freeze([
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);

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

function temperatureOf(value) {
  if (!Number.isFinite(value) || value < -100 || value > 150) return null;
  return value;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    throw new TypeError('CPU-frequency boost-headroom snapshot must be an object');
  }
  if (snapshot.engine !== 'system-facts') {
    throw new Error('CPU-frequency boost-headroom requires a system-facts snapshot');
  }
  if (!isRecord(snapshot.cpu)) {
    throw new TypeError('CPU-frequency boost-headroom snapshot requires a CPU section');
  }
  return snapshot;
}

function headroomOf(requested, observed) {
  if (requested === null || observed === null) return null;
  return Math.round(Math.min(1, Math.max(0, (requested - observed) / requested)) * 10000) / 10000;
}

function loadClass(utilization, highUtilizationThreshold) {
  if (utilization === null) return 'unknown';
  return utilization >= highUtilizationThreshold ? 'high' : 'normal';
}

function thermalClass(temperature, thermalTemperatureThreshold) {
  if (temperature === null) return 'unknown';
  return temperature >= thermalTemperatureThreshold ? 'hot' : 'normal';
}

function evidenceOf(snapshot, headroomThreshold, highUtilizationThreshold,
  thermalTemperatureThreshold) {
  const cpu = requireSnapshot(snapshot).cpu;
  const requested = frequencyOf(cpu.requestedFrequencyMHz);
  const observed = frequencyOf(cpu.observedFrequencyMHz);
  const base = frequencyOf(cpu.baseFrequencyMHz);
  const maximum = frequencyOf(cpu.maxFrequencyMHz);
  const utilization = utilizationOf(cpu.utilizationPercent);
  const temperature = temperatureOf(cpu.temperatureC);
  const invalidRange = (maximum !== null && base !== null && base > maximum)
    || (maximum !== null && requested !== null && requested > maximum)
    || (maximum !== null && observed !== null && observed > maximum);
  const headroom = headroomOf(requested, observed);
  const load = loadClass(utilization, highUtilizationThreshold);
  const thermal = thermalClass(temperature, thermalTemperatureThreshold);
  const shortfall = headroom !== null && headroom >= headroomThreshold;
  const satisfied = requested !== null && observed !== null && observed >= requested;
  return Object.freeze({
    requested,
    observed,
    base,
    maximum,
    utilization,
    temperature,
    headroom,
    load,
    thermal,
    invalidRange,
    shortfall,
    satisfied,
    shortfallUnderLoad: shortfall && load === 'high',
    thermalShortfall: shortfall && thermal === 'hot'
  });
}

function requireTrigger(trigger) {
  if (!CPU_FREQUENCY_HEADROOM_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported CPU-frequency boost-headroom trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 2 || windowSize > 64) {
    throw new RangeError('CPU-frequency boost-headroom windowSize must be an integer from 2 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('CPU-frequency boost-headroom minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireRatio(name, ratio) {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new RangeError(`CPU-frequency boost-headroom ${name} must be between 0 and 1`);
  }
  return ratio;
}

function requireUtilizationThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new RangeError('CPU-frequency boost-headroom highUtilizationThreshold must be between 0 and 100');
  }
  return threshold;
}

function requireTemperatureThreshold(threshold) {
  if (!Number.isFinite(threshold) || threshold < -100 || threshold > 150) {
    throw new RangeError('CPU-frequency boost-headroom thermalTemperatureThreshold must be between -100 and 150');
  }
  return threshold;
}

function requireCount(name, count) {
  if (!Number.isInteger(count) || count < 1 || count > 64) {
    throw new RangeError(`CPU-frequency boost-headroom ${name} must be an integer from 1 to 64`);
  }
  return count;
}

function observed(evidence) {
  return evidence.filter((item) => item.headroom !== null && !item.invalidRange);
}

function averageHeadroom(evidence) {
  const values = evidence
    .filter((item) => item.headroom !== null && !item.invalidRange)
    .map((item) => item.headroom);
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10000) / 10000;
}

function stateFor(sampleCount, minimumSamples, observedCount, invalidCount,
  thermalShortfallCount, shortfallUnderLoadCount, satisfiedCount, shortfallCount,
  thermalCountThreshold, shortfallCountThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (invalidCount > 0) return 'invalid-frequency-evidence';
  if (observedCount === 0) return 'no-observation';
  if (thermalShortfallCount >= thermalCountThreshold) return 'thermal-limited';
  if (shortfallUnderLoadCount >= shortfallCountThreshold) return 'boost-shortfall-under-load';
  if (satisfiedCount === observedCount) return 'request-satisfied';
  if (shortfallCount > 0) return 'variable-headroom';
  return 'request-satisfied';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-frequency-samples']);
  if (state === 'invalid-frequency-evidence') return Object.freeze(['review-frequency-sensor-range']);
  if (state === 'no-observation') return Object.freeze(['request-boost-headroom-observation']);
  if (state === 'thermal-limited') return Object.freeze(['review-thermal-limits-before-frequency-control']);
  if (state === 'boost-shortfall-under-load') return Object.freeze(['review-documented-boost-control']);
  if (state === 'variable-headroom') return Object.freeze(['observe-requested-frequency-stability']);
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
    throw new TypeError('CPU-frequency boost-headroom clock must return a number');
  }
  return timestamp;
}

export function runCpuFrequencyBoostHeadroomTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  headroomThreshold = 0.1,
  highUtilizationThreshold = 70,
  thermalTemperatureThreshold = 85,
  thermalCountThreshold = 2,
  shortfallCountThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) {
    throw new TypeError('CPU-frequency boost-headroom samples must be an array');
  }
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredHeadroom = requireRatio('headroomThreshold', headroomThreshold);
  const requiredUtilization = requireUtilizationThreshold(highUtilizationThreshold);
  const requiredTemperature = requireTemperatureThreshold(thermalTemperatureThreshold);
  const requiredThermalCount = requireCount('thermalCountThreshold', thermalCountThreshold);
  const requiredShortfallCount = requireCount('shortfallCountThreshold', shortfallCountThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => evidenceOf(sample, requiredHeadroom,
    requiredUtilization, requiredTemperature));
  const usable = observed(evidence);
  const invalidCount = evidence.filter((item) => item.invalidRange).length;
  const thermalShortfallCount = evidence.filter((item) => item.thermalShortfall).length;
  const shortfallUnderLoadCount = evidence.filter((item) => item.shortfallUnderLoad).length;
  const satisfiedCount = evidence.filter((item) => item.satisfied && !item.invalidRange).length;
  const shortfallCount = evidence.filter((item) => item.shortfall && !item.invalidRange).length;
  const thermalCount = evidence.filter((item) => item.thermal === 'hot').length;
  const state = stateFor(selected.length, requiredSamples, usable.length, invalidCount,
    thermalShortfallCount, shortfallUnderLoadCount, satisfiedCount, shortfallCount,
    requiredThermalCount, requiredShortfallCount);
  return Object.freeze({
    protocolVersion: 1,
    turbo: CPU_FREQUENCY_HEADROOM_TURBO_ID,
    turboVersion: CPU_FREQUENCY_HEADROOM_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    observedCount: usable.length,
    unknownCount: selected.length - usable.length - invalidCount,
    invalidCount,
    headroomThreshold: requiredHeadroom,
    highUtilizationThreshold: requiredUtilization,
    thermalTemperatureThreshold: requiredTemperature,
    thermalCount,
    thermalShortfallCount,
    shortfallUnderLoadCount,
    satisfiedCount,
    shortfallCount,
    averageHeadroom: averageHeadroom(evidence),
    state,
    confidence: confidence(selected.length, usable.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
