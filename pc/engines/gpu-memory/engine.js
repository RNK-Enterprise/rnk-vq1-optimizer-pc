/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * GPU-memory engine. It reports bounded VRAM capacity and usage evidence
 * without changing GPU policy, drivers, files, or transport state.
 */

export const GPU_MEMORY_ENGINE_ID = 'gpu-memory';
export const GPU_MEMORY_ENGINE_VERSION = 1;
export const GPU_MEMORY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('GPU-memory facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('GPU-memory requires system-facts facts');
  if (!Array.isArray(facts.gpus)) throw new TypeError('GPU-memory facts require a GPU list');
  return facts;
}

function requireTrigger(trigger) {
  if (!GPU_MEMORY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU-memory trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('GPU-memory clock must return a number');
  return timestamp;
}

function maximum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

function usagePercent(capacity, used) {
  if (capacity === null || capacity === 0 || used === null) return null;
  return Math.min(100, Math.max(0, (used / capacity) * 100));
}

function levelFor(percent) {
  if (percent === null) return 'unknown';
  if (percent >= 90) return 'high';
  if (percent >= 75) return 'elevated';
  return 'normal';
}

function evidenceFor(count, capacity, usedPercent) {
  if (count === 0) return 'none';
  if (capacity === null && usedPercent === null) return 'unknown';
  if (usedPercent === null) return 'capacity-only';
  return 'observed';
}

function operatingState(environment, count, level, observation) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-gpu';
  if (observation === false) return 'observation-disabled';
  if (level === 'unknown') return 'observation-required';
  if (level === 'high' && environment === 'headless') return 'protect-services';
  if (level === 'high') return 'protect-foreground';
  if (level === 'elevated') return 'watch';
  return 'observe';
}

function recommendations(environment, count, level, observation) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['keep-gpu-memory-controls-disabled']);
  if (observation === false) return Object.freeze(['keep-gpu-memory-observation-disabled']);
  if (level === 'unknown') return Object.freeze(['request-gpu-memory-observation']);
  if (level === 'high' && environment === 'headless') {
    return Object.freeze(['protect-services', 'hold-unapproved-memory-policy']);
  }
  if (level === 'high') return Object.freeze(['protect-foreground', 'hold-unapproved-memory-policy']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample', 'review-vram-headroom']);
  return Object.freeze(['no-change']);
}

function confidence(environment, count, capacity, usedPercent) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (count > 0) score += 0.2;
  if (capacity !== null) score += 0.2;
  if (usedPercent !== null) score += 0.4;
  return Math.round(score * 10000) / 10000;
}

export function runGpuMemoryEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const gpus = source.gpus.filter(isRecord);
  const rows = gpus.map((gpu) => ({
    model: text(gpu.model),
    capacity: nonNegative(gpu.vramBytes),
    used: nonNegative(gpu.vramUsedBytes)
  }));
  const capacity = maximum(rows, (row) => row.capacity);
  const used = maximum(rows, (row) => row.used);
  const usedPercent = maximum(rows, (row) => usagePercent(row.capacity, row.used));
  const level = levelFor(usedPercent);
  const evidence = evidenceFor(rows.length, capacity, usedPercent);
  const observation = source.capabilities?.gpuMemoryObservation !== false;
  return Object.freeze({
    protocolVersion: 1,
    engine: GPU_MEMORY_ENGINE_ID,
    engineVersion: GPU_MEMORY_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    gpuCount: rows.length,
    models: Object.freeze(rows.map((row) => row.model).filter(Boolean)),
    maximumVramBytes: capacity,
    maximumVramUsedBytes: used,
    maximumVramUsedPercent: usedPercent,
    evidence,
    level,
    observationEnabled: observation,
    state: operatingState(environment, rows.length, level, observation),
    confidence: confidence(environment, rows.length, capacity, usedPercent),
    recommendations: recommendations(environment, rows.length, level, observation),
    actions: EMPTY_ARRAY
  });
}
