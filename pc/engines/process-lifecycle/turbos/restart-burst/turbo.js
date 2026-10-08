/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Restart-burst turbo. It observes bounded restart evidence without
 * restarting, terminating, or otherwise changing a process.
 */

export const PROCESS_LIFECYCLE_RESTART_BURST_TURBO_ID = 'process-lifecycle.restart-burst';
export const PROCESS_LIFECYCLE_RESTART_BURST_TURBO_VERSION = 1;
export const PROCESS_LIFECYCLE_RESTART_BURST_TRIGGERS = Object.freeze([
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

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Restart-burst snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Restart-burst requires a system-facts snapshot');
  if (!Array.isArray(snapshot.processes)) throw new TypeError('Restart-burst snapshot requires a process list');
  return snapshot;
}

function requireTrigger(trigger) {
  if (!PROCESS_LIFECYCLE_RESTART_BURST_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported restart-burst trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Restart-burst windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Restart-burst minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Restart-burst ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireRestartThreshold(value) {
  if (!Number.isInteger(value) || value < 1 || value > 4096) {
    throw new RangeError('Restart-burst restartThreshold must be an integer from 1 to 4096');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Restart-burst clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function aggregate(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.processes.filter(isRecord);
  if (!environmentKnown(source)) return Object.freeze({ state: 'incomplete', processCount: rows.length, totalRestartCount: null });
  if (rows.length === 0) return Object.freeze({ state: 'no-processes', processCount: 0, totalRestartCount: null });
  const values = rows.map((row) => nonNegative(row.restartCount)).filter((value) => value !== null);
  if (values.length === 0) return Object.freeze({ state: 'incomplete', processCount: rows.length, totalRestartCount: null });
  return Object.freeze({
    state: 'observed',
    processCount: rows.length,
    totalRestartCount: values.reduce((sum, value) => sum + value, 0)
  });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, restartCount,
  persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-processes')) return 'no-processes';
  if (incompleteCount > 0) return 'incomplete-restart-evidence';
  if (restartCount >= persistenceThreshold) return 'restart-burst-sustained';
  if (restartCount > 0) return 'restart-burst-observed';
  return 'stable-lifecycle';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-restart-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-lifecycle-review']);
  if (state === 'incomplete-restart-evidence') return Object.freeze(['request-restart-observation']);
  if (state === 'restart-burst-sustained') return Object.freeze(['review-restart-policy', 'hold-unapproved-lifecycle-policy']);
  if (state === 'restart-burst-observed') return Object.freeze(['observe-next-restart-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runProcessLifecycleRestartBurstTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  restartThreshold = 1,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Restart-burst samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredRestart = requireRestartThreshold(restartThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(aggregate);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noProcessCount = evidence.filter((item) => item.state === 'no-processes').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const restartCount = evidence.filter((item) => item.totalRestartCount !== null
    && item.totalRestartCount >= requiredRestart).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, restartCount,
    requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ processCount: 0, totalRestartCount: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: PROCESS_LIFECYCLE_RESTART_BURST_TURBO_ID,
    turboVersion: PROCESS_LIFECYCLE_RESTART_BURST_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    restartThreshold: requiredRestart,
    persistenceThreshold: requiredPersistence,
    processCount: latest.processCount,
    totalRestartCount: latest.totalRestartCount,
    observedCount,
    incompleteCount,
    noProcessCount,
    restartSampleCount: restartCount,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
