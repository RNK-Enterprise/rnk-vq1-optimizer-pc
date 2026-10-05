/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-utilization library. It provides deterministic utilization classes,
 * deltas, sampling guidance, and an immutable local facade for the engine.
 */

export const CPU_UTILIZATION_LIBRARY_ID = 'cpu-utilization-library';
export const CPU_UTILIZATION_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedPercent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('CPU-utilization library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('CPU-utilization library requires normalized system facts');
  }
  if (!ENVIRONMENTS.includes(facts.environment) || !isRecord(facts.cpu)) {
    throw new TypeError('CPU-utilization library requires CPU facts');
  }
  return facts;
}

function levelFor(utilization) {
  if (utilization === null) return 'unknown';
  if (utilization >= 90) return 'high';
  if (utilization >= 70) return 'elevated';
  return 'normal';
}

function intervalFor(environment, level) {
  if (level === 'high') return 250;
  if (level === 'elevated') return 500;
  if (environment === 'interactive') return 1000;
  if (environment === 'headless') return 5000;
  return 2000;
}

function recommendationFor(level, environment) {
  if (level === 'unknown') return Object.freeze(['request-cpu-utilization-observation']);
  if (level === 'high' && environment === 'headless') return Object.freeze(['protect-services']);
  if (level === 'high') return Object.freeze(['protect-foreground']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample']);
  return Object.freeze(['no-change']);
}

export function classifyCpuUtilization(facts) {
  const source = requireFacts(facts);
  const utilization = boundedPercent(source.cpu.utilizationPercent);
  const level = levelFor(utilization);
  return Object.freeze({
    library: CPU_UTILIZATION_LIBRARY_ID,
    libraryVersion: CPU_UTILIZATION_LIBRARY_VERSION,
    environment: source.environment,
    utilizationPercent: utilization,
    level,
    samplingIntervalMs: intervalFor(source.environment, level),
    recommendations: recommendationFor(level, source.environment)
  });
}

export function compareCpuUtilization(previous, current) {
  const before = classifyCpuUtilization(previous);
  const after = classifyCpuUtilization(current);
  return Object.freeze({
    changed: before.utilizationPercent !== after.utilizationPercent,
    deltaPercent: before.utilizationPercent === null || after.utilizationPercent === null
      ? null
      : after.utilizationPercent - before.utilizationPercent,
    previousLevel: before.level,
    currentLevel: after.level
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('CPU-utilization library clock must return a number');
  return timestamp;
}

export function buildCpuUtilizationEnvelope(facts, {
  trigger,
  now = Date.now
} = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('CPU-utilization library trigger is required');
  }
  const classification = classifyCpuUtilization(facts);
  return Object.freeze({
    library: CPU_UTILIZATION_LIBRARY_ID,
    libraryVersion: CPU_UTILIZATION_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification
  });
}

export function createCpuUtilizationLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('CPU-utilization library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: CPU_UTILIZATION_LIBRARY_ID,
    version: CPU_UTILIZATION_LIBRARY_VERSION,
    classify: classifyCpuUtilization,
    compare: compareCpuUtilization,
    envelope: (facts, envelopeOptions = {}) => buildCpuUtilizationEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    }),
    emptyRecommendations: EMPTY_ARRAY
  });
}
