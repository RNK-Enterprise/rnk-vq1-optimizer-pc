/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Unknown-label turbo. It measures undocumented process-priority labels in
 * bounded observations without changing processes, files, or transport.
 */

export const PROCESS_PRIORITY_UNKNOWN_LABEL_TURBO_ID = 'process-priority.unknown-label';
export const PROCESS_PRIORITY_UNKNOWN_LABEL_TURBO_VERSION = 1;
export const PROCESS_PRIORITY_UNKNOWN_LABEL_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('Unknown-label snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Unknown-label requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.processes)) {
    throw new TypeError('Unknown-label snapshot requires a process list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!PROCESS_PRIORITY_UNKNOWN_LABEL_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported unknown-label trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Unknown-label windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Unknown-label minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Unknown-label ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireRate(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('Unknown-label rateThreshold must be between 0 and 1');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Unknown-label clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function processRows(snapshot) {
  return snapshot.processes.filter(isRecord).map((process) => priorityOf(process.priority));
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = processRows(source);
  if (!environmentKnown(source)) {
    return Object.freeze({ state: 'incomplete', processCount: rows.length, unknownCount: 0, unknownRate: 0 });
  }
  if (rows.length === 0) {
    return Object.freeze({ state: 'no-processes', processCount: 0, unknownCount: 0, unknownRate: 0 });
  }
  const unknownCount = rows.filter((priority) => priority === 'unknown').length;
  return Object.freeze({
    state: 'observed',
    processCount: rows.length,
    unknownCount,
    unknownRate: unknownCount / rows.length
  });
}

function persistence(evidence) {
  const unknownSamples = evidence.filter((item) => item.state === 'observed' && item.unknownCount > 0).length;
  const maximumRate = evidence.reduce((maximum, item) => Math.max(maximum, item.unknownRate), 0);
  return { unknownSamples, maximumRate };
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, unknownSamples,
  maximumRate, persistenceThreshold, rateThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-processes')) return 'no-processes';
  if (incompleteCount > 0) return 'incomplete-priority-evidence';
  if (unknownSamples >= persistenceThreshold && maximumRate >= rateThreshold) {
    return 'unknown-priority-sustained';
  }
  if (unknownSamples > 0) return 'unknown-priority-observed';
  return 'documented-priority';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-priority-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-priority-review']);
  if (state === 'incomplete-priority-evidence') {
    return Object.freeze(['request-priority-environment-evidence']);
  }
  if (state === 'unknown-priority-sustained') {
    return Object.freeze(['document-priority-labels', 'hold-unknown-priority-policy']);
  }
  if (state === 'unknown-priority-observed') return Object.freeze(['observe-next-priority-label']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runProcessPriorityUnknownLabelTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  rateThreshold = 0.25,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Unknown-label samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const requiredRate = requireRate(rateThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noProcessCount = evidence.filter((item) => item.state === 'no-processes').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const unknownCount = evidence.reduce((total, item) => total + item.unknownCount, 0);
  const trend = persistence(evidence);
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount,
    trend.unknownSamples, trend.maximumRate, requiredPersistence, requiredRate);
  const latest = evidence.at(-1) || Object.freeze({ processCount: 0, unknownCount: 0, unknownRate: 0 });
  return Object.freeze({
    protocolVersion: 1,
    turbo: PROCESS_PRIORITY_UNKNOWN_LABEL_TURBO_ID,
    turboVersion: PROCESS_PRIORITY_UNKNOWN_LABEL_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    rateThreshold: requiredRate,
    processCount: latest.processCount,
    unknownCount,
    latestUnknownCount: latest.unknownCount,
    latestUnknownRate: latest.unknownRate,
    observedCount,
    incompleteCount,
    noProcessCount,
    unknownSamples: trend.unknownSamples,
    maximumRate: trend.maximumRate,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
