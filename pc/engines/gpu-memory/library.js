/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * GPU-memory library. It evaluates bounded VRAM occupancy for review only and
 * never evicts resources, changes allocation policy, or touches applications.
 */

export const GPU_MEMORY_LIBRARY_ID = 'gpu-memory-library';
export const GPU_MEMORY_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function percent(value) {
  return Math.min(100, Math.max(0, value));
}

function occupancy(gpu) {
  const total = nonNegative(gpu.vramBytes);
  const used = nonNegative(gpu.vramUsedBytes);
  if (total === null || used === null || total === 0) return null;
  return percent((used / total) * 100);
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('GPU-memory library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('GPU-memory library requires normalized system facts');
  }
  if (!Array.isArray(facts.gpus)) throw new TypeError('GPU-memory library requires a GPU list');
  return facts;
}

function maximum(values) {
  const known = values.filter((value) => value !== null);
  return known.length === 0 ? null : Math.max(...known);
}

function levelFor(usedPercent, count) {
  if (count === 0) return 'none';
  if (usedPercent === null) return 'unknown';
  if (usedPercent >= 90) return 'high';
  if (usedPercent >= 75) return 'elevated';
  return 'normal';
}

function recommendations(environment, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (level === 'none') return Object.freeze(['no-change', 'keep-gpu-memory-controls-disabled']);
  if (level === 'unknown') return Object.freeze(['request-vram-observation']);
  if (level === 'high' && environment === 'headless') {
    return Object.freeze(['protect-services', 'hold-unapproved-memory-policy']);
  }
  if (level === 'high') return Object.freeze(['protect-foreground', 'hold-unapproved-memory-policy']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample', 'review-vram-headroom']);
  return Object.freeze(['no-change']);
}

export function classifyGpuMemory(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const gpus = source.gpus.filter(isRecord);
  const occupancies = gpus.map(occupancy);
  const usedPercent = maximum(occupancies);
  const totalBytes = maximum(gpus.map((gpu) => nonNegative(gpu.vramBytes)));
  const level = levelFor(usedPercent, gpus.length);
  return Object.freeze({
    library: GPU_MEMORY_LIBRARY_ID,
    libraryVersion: GPU_MEMORY_LIBRARY_VERSION,
    environment,
    gpuCount: gpus.length,
    totalVramBytes: totalBytes,
    maximumUsedPercent: usedPercent,
    occupancyKnownCount: occupancies.filter((value) => value !== null).length,
    level,
    recommendations: recommendations(environment, level)
  });
}

export function compareGpuMemory(previous, current) {
  const before = classifyGpuMemory(previous);
  const after = classifyGpuMemory(current);
  const levelChanged = before.level !== after.level;
  const occupancyChanged = before.maximumUsedPercent !== after.maximumUsedPercent;
  const countChanged = before.gpuCount !== after.gpuCount;
  return Object.freeze({
    changed: levelChanged || occupancyChanged || countChanged,
    levelChanged,
    occupancyChanged,
    countChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU-memory library clock must return a number');
  return timestamp;
}

export function buildGpuMemoryEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('GPU-memory library trigger is required');
  }
  return Object.freeze({
    library: GPU_MEMORY_LIBRARY_ID,
    libraryVersion: GPU_MEMORY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyGpuMemory(facts)
  });
}

export function createGpuMemoryLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('GPU-memory library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: GPU_MEMORY_LIBRARY_ID,
    version: GPU_MEMORY_LIBRARY_VERSION,
    classify: classifyGpuMemory,
    compare: compareGpuMemory,
    envelope: (facts, envelopeOptions = {}) => buildGpuMemoryEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
