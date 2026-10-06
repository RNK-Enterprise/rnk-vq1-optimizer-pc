/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Zombie-persistence turbo. It observes bounded zombie-process evidence
 * without terminating, reparenting, or changing a process.
 */

export const PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_TURBO_ID = 'process-lifecycle.zombie-persistence';
export const PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_TURBO_VERSION = 1;
export const PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const STATES = Object.freeze(['running', 'sleeping', 'stopped', 'zombie']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stateOf(value) {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim().toLowerCase();
  return STATES.includes(normalized) ? normalized : 'unknown';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Zombie-persistence snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Zombie-persistence requires a system-facts snapshot');
  if (!Array.isArray(snapshot.processes)) throw new TypeError('Zombie-persistence snapshot requires a process list');
  return snapshot;
}

function requireTrigger(trigger) {
  if (!PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported zombie-persistence trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Zombie-persistence windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Zombie-persistence minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Zombie-persistence ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Zombie-persistence clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function aggregate(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.processes.filter(isRecord).map((process) => stateOf(process.state));
  if (!environmentKnown(source)) return Object.freeze({ state: 'incomplete', processCount: rows.length, zombieCount: 0 });
  if (rows.length === 0) return Object.freeze({ state: 'no-processes', processCount: 0, zombieCount: 0 });
  if (rows.some((state) => state === 'unknown')) return Object.freeze({ state: 'incomplete', processCount: rows.length, zombieCount: 0 });
  return Object.freeze({
    state: 'observed',
    processCount: rows.length,
    zombieCount: rows.filter((state) => state === 'zombie').length
  });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, zombieSampleCount,
  persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-processes')) return 'no-processes';
  if (incompleteCount > 0) return 'incomplete-zombie-evidence';
  if (zombieSampleCount >= persistenceThreshold) return 'zombie-persistence-sustained';
  if (zombieSampleCount > 0) return 'zombie-persistence-observed';
  return 'no-zombie-observed';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-zombie-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-lifecycle-review']);
  if (state === 'incomplete-zombie-evidence') return Object.freeze(['request-process-state-observation']);
  if (state === 'zombie-persistence-sustained') return Object.freeze(['review-zombie-process-ownership', 'hold-process-mutation']);
  if (state === 'zombie-persistence-observed') return Object.freeze(['observe-next-zombie-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runProcessLifecycleZombiePersistenceTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Zombie-persistence samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(aggregate);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noProcessCount = evidence.filter((item) => item.state === 'no-processes').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const zombieSampleCount = evidence.filter((item) => item.state === 'observed' && item.zombieCount > 0).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, zombieSampleCount,
    requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ processCount: 0, zombieCount: 0 });
  return Object.freeze({
    protocolVersion: 1,
    turbo: PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_TURBO_ID,
    turboVersion: PROCESS_LIFECYCLE_ZOMBIE_PERSISTENCE_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    processCount: latest.processCount,
    zombieCount: latest.zombieCount,
    observedCount,
    incompleteCount,
    noProcessCount,
    zombieSampleCount,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
