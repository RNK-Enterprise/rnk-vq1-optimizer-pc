/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Memory-pressure library. It turns normalized RAM evidence into an immutable
 * review object; it never reclaims memory, clears caches, or changes policy.
 */

export const MEMORY_PRESSURE_LIBRARY_ID = 'memory-pressure-library';
export const MEMORY_PRESSURE_LIBRARY_VERSION = 1;

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

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Memory-pressure library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Memory-pressure library requires normalized system facts');
  }
  if (!isRecord(facts.memory)) throw new TypeError('Memory-pressure library requires memory facts');
  return facts;
}

function levelFor(usedPercent) {
  if (usedPercent === null) return 'unknown';
  if (usedPercent >= 90) return 'high';
  if (usedPercent >= 75) return 'elevated';
  return 'normal';
}

function recommendations(environment, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (level === 'unknown') return Object.freeze(['request-memory-observation']);
  if (level === 'high' && environment === 'headless') {
    return Object.freeze(['protect-services', 'hold-destructive-actions']);
  }
  if (level === 'high') return Object.freeze(['protect-foreground', 'hold-destructive-actions']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample', 'review-approved-memory-policy']);
  return Object.freeze(['no-change']);
}

export function classifyMemoryPressure(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const usedPercent = percent(source.memory.usedPercent);
  const availableBytes = nonNegative(source.memory.availableBytes);
  const swapUsedPercent = percent(source.memory.swapUsedPercent);
  const level = levelFor(usedPercent);
  return Object.freeze({
    library: MEMORY_PRESSURE_LIBRARY_ID,
    libraryVersion: MEMORY_PRESSURE_LIBRARY_VERSION,
    environment,
    usedPercent,
    headroomPercent: usedPercent === null ? null : Math.round((100 - usedPercent) * 100) / 100,
    availableBytes,
    swapUsedPercent,
    level,
    recommendations: recommendations(environment, level)
  });
}

export function compareMemoryPressure(previous, current) {
  const before = classifyMemoryPressure(previous);
  const after = classifyMemoryPressure(current);
  const levelChanged = before.level !== after.level;
  const usedChanged = before.usedPercent !== after.usedPercent;
  const swapChanged = before.swapUsedPercent !== after.swapUsedPercent;
  return Object.freeze({
    changed: levelChanged || usedChanged || swapChanged,
    levelChanged,
    usedChanged,
    swapChanged,
    headroomDelta: before.headroomPercent === null || after.headroomPercent === null
      ? null : after.headroomPercent - before.headroomPercent
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Memory-pressure library clock must return a number');
  return timestamp;
}

export function buildMemoryPressureEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Memory-pressure library trigger is required');
  }
  return Object.freeze({
    library: MEMORY_PRESSURE_LIBRARY_ID,
    libraryVersion: MEMORY_PRESSURE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyMemoryPressure(facts)
  });
}

export function createMemoryPressureLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Memory-pressure library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: MEMORY_PRESSURE_LIBRARY_ID,
    version: MEMORY_PRESSURE_LIBRARY_VERSION,
    classify: classifyMemoryPressure,
    compare: compareMemoryPressure,
    envelope: (facts, envelopeOptions = {}) => buildMemoryPressureEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
