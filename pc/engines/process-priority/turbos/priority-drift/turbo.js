/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Process priority-drift turbo. It compares bounded, normalized process
 * priority observations without changing priorities, processes, files, or
 * transport state.
 */

export const PROCESS_PRIORITY_DRIFT_TURBO_ID = 'process-priority.priority-drift';
export const PROCESS_PRIORITY_DRIFT_TURBO_VERSION = 1;
export const PROCESS_PRIORITY_DRIFT_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const PRIORITIES = Object.freeze(['idle', 'below-normal', 'normal', 'above-normal', 'high', 'realtime']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function priorityOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
  const normalized = value.trim().toLowerCase();
  return PRIORITIES.includes(normalized) ? normalized : 'unknown';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Priority-drift snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Priority-drift requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.processes)) {
    throw new TypeError('Priority-drift snapshot requires a process list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!PROCESS_PRIORITY_DRIFT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported priority-drift trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Priority-drift windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Priority-drift minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Priority-drift ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Priority-drift clock must return a number');
  return timestamp;
}

function environmentOf(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) ? snapshot.environment : 'unknown';
}

function processRows(snapshot) {
  return snapshot.processes.filter(isRecord).map((process, index) => ({
    name: typeof process.name === 'string' && process.name.trim().length > 0
      ? process.name.trim()
      : `process-${index}`,
    priority: priorityOf(process.priority)
  }));
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = processRows(source);
  if (environmentOf(source) === 'unknown') {
    return Object.freeze({ state: 'incomplete', processCount: rows.length, signature: null });
  }
  if (rows.length === 0) {
    return Object.freeze({ state: 'no-processes', processCount: 0, signature: '' });
  }
  if (rows.some((row) => row.priority === 'unknown')) {
    return Object.freeze({ state: 'incomplete', processCount: rows.length, signature: null });
  }
  const signature = rows.map((row) => `${row.name}:${row.priority}`).join('|');
  return Object.freeze({ state: 'observed', processCount: rows.length, signature });
}

function movement(evidence) {
  let transitionCount = 0;
  let comparisonCount = 0;
  let previous = null;
  for (const current of evidence) {
    if (current.state !== 'observed') {
      previous = null;
      continue;
    }
    if (previous !== null) {
      comparisonCount += 1;
      if (current.signature !== previous) transitionCount += 1;
    }
    previous = current.signature;
  }
  return { transitionCount, comparisonCount };
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, transitionCount,
  changeThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-processes')) return 'no-processes';
  if (incompleteCount > 0) return 'incomplete-priority-evidence';
  if (transitionCount >= changeThreshold) return 'priority-drift-sustained';
  if (transitionCount > 0) return 'priority-drift-observed';
  return 'stable-priority';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-priority-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-priority-review']);
  if (state === 'incomplete-priority-evidence') {
    return Object.freeze(['request-documented-priority-observation']);
  }
  if (state === 'priority-drift-sustained') {
    return Object.freeze(['review-priority-drift', 'hold-unapproved-priority-policy']);
  }
  if (state === 'priority-drift-observed') return Object.freeze(['observe-next-priority-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runProcessPriorityDriftTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  changeThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Priority-drift samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredChanges = requireCount('changeThreshold', changeThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noProcessCount = evidence.filter((item) => item.state === 'no-processes').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const trend = movement(evidence);
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount,
    trend.transitionCount, requiredChanges);
  const latest = evidence.at(-1) || Object.freeze({ processCount: 0, signature: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: PROCESS_PRIORITY_DRIFT_TURBO_ID,
    turboVersion: PROCESS_PRIORITY_DRIFT_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    changeThreshold: requiredChanges,
    processCount: latest.processCount,
    observedCount,
    incompleteCount,
    noProcessCount,
    transitionCount: trend.transitionCount,
    comparisonCount: trend.comparisonCount,
    latestPrioritySignature: latest.signature,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
