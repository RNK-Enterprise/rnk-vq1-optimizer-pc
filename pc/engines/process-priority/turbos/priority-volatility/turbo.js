/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Priority-volatility turbo. It compares bounded process priority and
 * protection signatures without changing process state, files, or transport.
 */

export const PROCESS_PRIORITY_VOLATILITY_TURBO_ID = 'process-priority.priority-volatility';
export const PROCESS_PRIORITY_VOLATILITY_TURBO_VERSION = 1;
export const PROCESS_PRIORITY_VOLATILITY_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('Priority-volatility snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Priority-volatility requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.processes)) {
    throw new TypeError('Priority-volatility snapshot requires a process list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!PROCESS_PRIORITY_VOLATILITY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported priority-volatility trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Priority-volatility windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Priority-volatility minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Priority-volatility ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Priority-volatility clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function processRows(snapshot) {
  return snapshot.processes.filter(isRecord).map((process, index) => ({
    name: typeof process.name === 'string' && process.name.trim().length > 0
      ? process.name.trim()
      : `process-${index}`,
    priority: priorityOf(process.priority),
    foreground: process.foreground === true,
    protected: process.protected === true
  }));
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = processRows(source);
  if (!environmentKnown(source)) {
    return Object.freeze({ state: 'incomplete', processCount: rows.length, signature: null });
  }
  if (rows.length === 0) {
    return Object.freeze({ state: 'no-processes', processCount: 0, signature: '' });
  }
  if (rows.some((row) => row.priority === 'unknown')) {
    return Object.freeze({ state: 'incomplete', processCount: rows.length, signature: null });
  }
  const signature = rows.map((row) => [row.name, row.priority, row.foreground, row.protected].join(':')).join('|');
  return Object.freeze({ state: 'observed', processCount: rows.length, signature });
}

function movement(evidence) {
  let volatilityCount = 0;
  let comparisonCount = 0;
  let previous = null;
  for (const current of evidence) {
    if (current.state !== 'observed') {
      previous = null;
      continue;
    }
    if (previous !== null) {
      comparisonCount += 1;
      if (current.signature !== previous) volatilityCount += 1;
    }
    previous = current.signature;
  }
  return { volatilityCount, comparisonCount };
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, volatilityCount,
  changeThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-processes')) return 'no-processes';
  if (incompleteCount > 0) return 'incomplete-volatility-evidence';
  if (volatilityCount >= changeThreshold) return 'priority-volatility-sustained';
  if (volatilityCount > 0) return 'priority-volatility-observed';
  return 'stable-priority-state';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-priority-state-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-volatility-review']);
  if (state === 'incomplete-volatility-evidence') {
    return Object.freeze(['request-complete-priority-state-evidence']);
  }
  if (state === 'priority-volatility-sustained') {
    return Object.freeze(['review-priority-state-volatility', 'hold-unapproved-priority-policy']);
  }
  if (state === 'priority-volatility-observed') return Object.freeze(['observe-next-priority-state']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runProcessPriorityVolatilityTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  changeThreshold = 1,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Priority-volatility samples must be an array');
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
    trend.volatilityCount, requiredChanges);
  const latest = evidence.at(-1) || Object.freeze({ processCount: 0, signature: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: PROCESS_PRIORITY_VOLATILITY_TURBO_ID,
    turboVersion: PROCESS_PRIORITY_VOLATILITY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    changeThreshold: requiredChanges,
    processCount: latest.processCount,
    observedCount,
    incompleteCount,
    noProcessCount,
    volatilityCount: trend.volatilityCount,
    comparisonCount: trend.comparisonCount,
    latestPriorityStateSignature: latest.signature,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
