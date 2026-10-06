/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Process-lifecycle library. It classifies state and restart evidence for
 * review and never terminates, restarts, suspends, or re-parents processes.
 */

export const PROCESS_LIFECYCLE_LIBRARY_ID = 'process-lifecycle-library';
export const PROCESS_LIFECYCLE_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const STATES = Object.freeze(['running', 'sleeping', 'stopped', 'zombie']);

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
  if (!isRecord(facts)) throw new TypeError('Process-lifecycle library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Process-lifecycle library requires normalized system facts');
  }
  if (!Array.isArray(facts.processes)) {
    throw new TypeError('Process-lifecycle library requires a process list');
  }
  return facts;
}

function maximum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

function sum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
}

function recommendations(environment, count, unknownCount, zombieCount, restartCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-process-lifecycle-review']);
  if (unknownCount > 0) return Object.freeze(['request-process-state-observation']);
  if (zombieCount > 0) return Object.freeze(['review-zombie-process-ownership']);
  if (restartCount > 0) return Object.freeze(['review-restart-policy']);
  return Object.freeze(['no-change']);
}

export function classifyProcessLifecycle(facts) {
  const source = requireFacts(facts);
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
  return Object.freeze({
    library: PROCESS_LIFECYCLE_LIBRARY_ID,
    libraryVersion: PROCESS_LIFECYCLE_LIBRARY_VERSION,
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
    recommendations: recommendations(environment, processes.length, unknownCount, zombieCount, restartCount)
  });
}

export function compareProcessLifecycle(previous, current) {
  const before = classifyProcessLifecycle(previous);
  const after = classifyProcessLifecycle(current);
  const countChanged = before.processCount !== after.processCount;
  const zombieChanged = before.zombieCount !== after.zombieCount;
  const restartChanged = before.totalRestartCount !== after.totalRestartCount;
  const uptimeChanged = before.maximumUptimeSeconds !== after.maximumUptimeSeconds;
  return Object.freeze({
    changed: countChanged || zombieChanged || restartChanged || uptimeChanged,
    countChanged,
    zombieChanged,
    restartChanged,
    uptimeChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Process-lifecycle library clock must return a number');
  return timestamp;
}

export function buildProcessLifecycleEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Process-lifecycle library trigger is required');
  }
  return Object.freeze({
    library: PROCESS_LIFECYCLE_LIBRARY_ID,
    libraryVersion: PROCESS_LIFECYCLE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyProcessLifecycle(facts)
  });
}

export function createProcessLifecycleLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Process-lifecycle library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: PROCESS_LIFECYCLE_LIBRARY_ID,
    version: PROCESS_LIFECYCLE_LIBRARY_VERSION,
    classify: classifyProcessLifecycle,
    compare: compareProcessLifecycle,
    envelope: (facts, envelopeOptions = {}) => buildProcessLifecycleEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
