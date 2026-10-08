/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Process-lifecycle engine. It classifies process states and restart evidence
 * without terminating, restarting, suspending, or changing process files.
 */

export const PROCESS_LIFECYCLE_ENGINE_ID = 'process-lifecycle';
export const PROCESS_LIFECYCLE_ENGINE_VERSION = 1;
export const PROCESS_LIFECYCLE_TRIGGERS = Object.freeze([
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

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Process-lifecycle facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Process-lifecycle requires system-facts facts');
  if (!Array.isArray(facts.processes)) throw new TypeError('Process-lifecycle facts require a process list');
  return facts;
}

function requireTrigger(trigger) {
  if (!PROCESS_LIFECYCLE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported process-lifecycle trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Process-lifecycle clock must return a number');
  return timestamp;
}

function maximum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

function sum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
}

function operatingState(environment, count, unknownCount, zombieCount, restartCount) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-processes';
  if (unknownCount > 0) return 'observation-required';
  if (zombieCount > 0) return 'lifecycle-review';
  if (restartCount > 0) return 'restart-review';
  return 'observe';
}

function recommendations(environment, count, unknownCount, zombieCount, restartCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-process-lifecycle-review']);
  if (unknownCount > 0) return Object.freeze(['request-process-state-observation']);
  if (zombieCount > 0) return Object.freeze(['review-zombie-process-ownership']);
  if (restartCount > 0) return Object.freeze(['review-restart-policy']);
  return Object.freeze(['no-change']);
}

function confidence(environment, count, unknownCount, uptimeKnown) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (count > 0) score += 0.2;
  if (unknownCount === 0 && count > 0) score += 0.3;
  if (uptimeKnown) score += 0.3;
  return Math.round(score * 10000) / 10000;
}

export function runProcessLifecycleEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const processes = source.processes.filter(isRecord).map((process) => ({
    name: text(process.name),
    state: stateOf(process.state),
    uptimeSeconds: nonNegative(process.uptimeSeconds),
    restartCount: nonNegative(process.restartCount)
  }));
  const unknownCount = processes.filter((process) => process.state === 'unknown').length;
  const zombieCount = processes.filter((process) => process.state === 'zombie').length;
  const restartCount = sum(processes, (process) => process.restartCount);
  const maxUptimeSeconds = maximum(processes, (process) => process.uptimeSeconds);
  const state = operatingState(environment, processes.length, unknownCount, zombieCount, restartCount);
  return Object.freeze({
    protocolVersion: 1,
    engine: PROCESS_LIFECYCLE_ENGINE_ID,
    engineVersion: PROCESS_LIFECYCLE_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    processCount: processes.length,
    names: Object.freeze(processes.map((process) => process.name).filter(Boolean)),
    states: Object.freeze(processes.map((process) => process.state)),
    runningCount: processes.filter((process) => process.state === 'running').length,
    sleepingCount: processes.filter((process) => process.state === 'sleeping').length,
    stoppedCount: processes.filter((process) => process.state === 'stopped').length,
    zombieCount,
    unknownStateCount: unknownCount,
    totalRestartCount: restartCount,
    maximumUptimeSeconds: maxUptimeSeconds,
    state,
    confidence: confidence(environment, processes.length, unknownCount, maxUptimeSeconds !== null),
    recommendations: recommendations(environment, processes.length, unknownCount, zombieCount, restartCount),
    actions: EMPTY_ARRAY
  });
}
