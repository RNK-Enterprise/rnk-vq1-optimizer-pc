/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * CPU-scheduler library. It classifies run-queue and context-switch evidence
 * and provides deterministic local envelopes without changing scheduling.
 */

export const CPU_SCHEDULER_LIBRARY_ID = 'cpu-scheduler-library';
export const CPU_SCHEDULER_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('CPU-scheduler library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('CPU-scheduler library requires normalized system facts');
  }
  if (!ENVIRONMENTS.includes(facts.environment) || !isRecord(facts.cpu)) {
    throw new TypeError('CPU-scheduler library requires CPU facts');
  }
  return facts;
}

function levelFor(runQueue, contextSwitches, logicalCpus) {
  if (runQueue === null && contextSwitches === null) return 'unknown';
  const queueHigh = runQueue !== null && (runQueue >= 8 || (
    logicalCpus !== null && runQueue >= logicalCpus * 2
  ));
  const queueElevated = runQueue !== null && (runQueue >= 4 || (
    logicalCpus !== null && runQueue >= logicalCpus
  ));
  if (queueHigh || (contextSwitches !== null && contextSwitches >= 100000)) return 'high';
  if (queueElevated || (contextSwitches !== null && contextSwitches >= 50000)) return 'elevated';
  return 'normal';
}

function intervalFor(level, environment) {
  if (level === 'high') return 250;
  if (level === 'elevated') return 500;
  if (environment === 'interactive') return 1000;
  if (environment === 'headless') return 5000;
  return 2000;
}

function recommendations(level, environment) {
  if (level === 'unknown') return Object.freeze(['request-scheduler-observation']);
  if (level === 'high' && environment === 'headless') return Object.freeze(['protect-services']);
  if (level === 'high') return Object.freeze(['protect-foreground']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample']);
  return Object.freeze(['no-change']);
}

export function classifyCpuScheduler(facts) {
  const source = requireFacts(facts);
  const runQueue = nonNegative(source.cpu.runQueueLength);
  const contextSwitches = nonNegative(source.cpu.contextSwitchesPerSecond);
  const logicalCpus = nonNegative(source.cpu.logicalCpus);
  const level = levelFor(runQueue, contextSwitches, logicalCpus);
  return Object.freeze({
    library: CPU_SCHEDULER_LIBRARY_ID,
    libraryVersion: CPU_SCHEDULER_LIBRARY_VERSION,
    environment: source.environment,
    runQueueLength: runQueue,
    contextSwitchesPerSecond: contextSwitches,
    logicalCpus,
    level,
    samplingIntervalMs: intervalFor(level, source.environment),
    recommendations: recommendations(level, source.environment)
  });
}

export function compareCpuScheduler(previous, current) {
  const before = classifyCpuScheduler(previous);
  const after = classifyCpuScheduler(current);
  return Object.freeze({
    changed: before.level !== after.level
      || before.runQueueLength !== after.runQueueLength
      || before.contextSwitchesPerSecond !== after.contextSwitchesPerSecond,
    runQueueDelta: before.runQueueLength === null || after.runQueueLength === null
      ? null
      : after.runQueueLength - before.runQueueLength,
    contextSwitchDelta: before.contextSwitchesPerSecond === null
      || after.contextSwitchesPerSecond === null
      ? null
      : after.contextSwitchesPerSecond - before.contextSwitchesPerSecond,
    previousLevel: before.level,
    currentLevel: after.level
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('CPU-scheduler library clock must return a number');
  return timestamp;
}

export function buildCpuSchedulerEnvelope(facts, {
  trigger,
  now = Date.now
} = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('CPU-scheduler library trigger is required');
  }
  return Object.freeze({
    library: CPU_SCHEDULER_LIBRARY_ID,
    libraryVersion: CPU_SCHEDULER_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyCpuScheduler(facts)
  });
}

export function createCpuSchedulerLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('CPU-scheduler library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: CPU_SCHEDULER_LIBRARY_ID,
    version: CPU_SCHEDULER_LIBRARY_VERSION,
    classify: classifyCpuScheduler,
    compare: compareCpuScheduler,
    envelope: (facts, envelopeOptions = {}) => buildCpuSchedulerEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    }),
    emptyRecommendations: EMPTY_ARRAY
  });
}
