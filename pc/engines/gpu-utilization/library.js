/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * GPU-utilization library. It aggregates bounded observations for review and
 * never changes drivers, clocks, fan policy, files, or transport.
 */

export const GPU_UTILIZATION_LIBRARY_ID = 'gpu-utilization-library';
export const GPU_UTILIZATION_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('GPU-utilization library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('GPU-utilization library requires normalized system facts');
  }
  if (!Array.isArray(facts.gpus)) throw new TypeError('GPU-utilization library requires a GPU list');
  return facts;
}

function maximum(gpus, selector) {
  const values = gpus.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

function levelFor(utilization, temperature, count) {
  if (count === 0) return 'none';
  if (utilization === null && temperature === null) return 'unknown';
  if ((utilization !== null && utilization >= 90)
    || (temperature !== null && temperature >= 85)) return 'high';
  if ((utilization !== null && utilization >= 70)
    || (temperature !== null && temperature >= 75)) return 'elevated';
  return 'normal';
}

function recommendations(environment, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (level === 'none') return Object.freeze(['no-change', 'keep-gpu-controls-disabled']);
  if (level === 'unknown') return Object.freeze(['request-gpu-observation']);
  if (level === 'high' && environment === 'headless') {
    return Object.freeze(['protect-services', 'hold-unapproved-gpu-policy']);
  }
  if (level === 'high') return Object.freeze(['protect-foreground', 'hold-unapproved-gpu-policy']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample', 'review-thermal-headroom']);
  return Object.freeze(['no-change']);
}

export function classifyGpuUtilization(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const gpus = source.gpus.filter(isRecord);
  const utilization = maximum(gpus, (gpu) => percent(gpu.utilizationPercent));
  const temperature = maximum(gpus, (gpu) => percent(gpu.temperatureCelsius));
  const vramBytes = maximum(gpus, (gpu) => nonNegative(gpu.vramBytes));
  const level = levelFor(utilization, temperature, gpus.length);
  return Object.freeze({
    library: GPU_UTILIZATION_LIBRARY_ID,
    libraryVersion: GPU_UTILIZATION_LIBRARY_VERSION,
    environment,
    gpuCount: gpus.length,
    models: Object.freeze(gpus.map((gpu) => text(gpu.model)).filter(Boolean)),
    utilizationPercent: utilization,
    temperatureCelsius: temperature,
    maximumVramBytes: vramBytes,
    level,
    recommendations: recommendations(environment, level)
  });
}

export function compareGpuUtilization(previous, current) {
  const before = classifyGpuUtilization(previous);
  const after = classifyGpuUtilization(current);
  const levelChanged = before.level !== after.level;
  const utilizationChanged = before.utilizationPercent !== after.utilizationPercent;
  const temperatureChanged = before.temperatureCelsius !== after.temperatureCelsius;
  return Object.freeze({
    changed: levelChanged || utilizationChanged || temperatureChanged,
    levelChanged,
    utilizationChanged,
    temperatureChanged,
    gpuCountDelta: after.gpuCount - before.gpuCount
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU-utilization library clock must return a number');
  return timestamp;
}

export function buildGpuUtilizationEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('GPU-utilization library trigger is required');
  }
  return Object.freeze({
    library: GPU_UTILIZATION_LIBRARY_ID,
    libraryVersion: GPU_UTILIZATION_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyGpuUtilization(facts)
  });
}

export function createGpuUtilizationLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('GPU-utilization library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: GPU_UTILIZATION_LIBRARY_ID,
    version: GPU_UTILIZATION_LIBRARY_VERSION,
    classify: classifyGpuUtilization,
    compare: compareGpuUtilization,
    envelope: (facts, envelopeOptions = {}) => buildGpuUtilizationEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
