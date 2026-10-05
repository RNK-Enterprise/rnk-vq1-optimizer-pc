/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Process-I/O engine. It aggregates bounded process I/O observations without
 * changing priorities, processes, files, or transport state.
 */

export const PROCESS_IO_ENGINE_ID = 'process-io';
export const PROCESS_IO_ENGINE_VERSION = 1;
export const PROCESS_IO_TRIGGERS = Object.freeze([
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

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Process-I/O facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Process-I/O requires system-facts facts');
  if (!Array.isArray(facts.processes)) throw new TypeError('Process-I/O facts require a process list');
  return facts;
}

function requireTrigger(trigger) {
  if (!PROCESS_IO_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported process-I/O trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Process-I/O clock must return a number');
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

function levelFor(waitPercent, readRate, writeRate) {
  if (waitPercent === null && readRate === null && writeRate === null) return 'unknown';
  if (waitPercent !== null && waitPercent >= 30) return 'high';
  if (waitPercent !== null && waitPercent >= 10) return 'elevated';
  return 'normal';
}

function operatingState(environment, observation, count, level) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-processes';
  if (observation === false) return 'observation-disabled';
  if (level === 'unknown') return 'observation-required';
  if (level === 'high') return 'protect-services';
  if (level === 'elevated') return 'watch';
  return 'observe';
}

function recommendations(environment, observation, count, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-process-io-review']);
  if (observation === false) return Object.freeze(['keep-process-io-observation-disabled']);
  if (level === 'unknown') return Object.freeze(['request-process-io-observation']);
  if (level === 'high') return Object.freeze(['protect-services', 'review-storage-contention']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample', 'review-storage-contention']);
  return Object.freeze(['no-change']);
}

function confidence(environment, count, waitPercent, readRate, writeRate) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (count > 0) score += 0.2;
  if (waitPercent !== null) score += 0.2;
  if (readRate !== null) score += 0.2;
  if (writeRate !== null) score += 0.2;
  return Math.round(score * 10000) / 10000;
}

export function runProcessIoEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const processes = source.processes.filter(isRecord).map((process) => ({
    name: text(process.name),
    readRate: nonNegative(process.ioReadBytesPerSecond),
    writeRate: nonNegative(process.ioWriteBytesPerSecond),
    waitPercent: percent(process.ioWaitPercent)
  }));
  const readRate = sum(processes, (process) => process.readRate);
  const writeRate = sum(processes, (process) => process.writeRate);
  const waitPercent = maximum(processes, (process) => process.waitPercent);
  const level = levelFor(waitPercent, readRate, writeRate);
  const observation = source.capabilities?.processIoObservation !== false;
  return Object.freeze({
    protocolVersion: 1,
    engine: PROCESS_IO_ENGINE_ID,
    engineVersion: PROCESS_IO_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    processCount: processes.length,
    names: Object.freeze(processes.map((process) => process.name).filter(Boolean)),
    totalReadBytesPerSecond: readRate,
    totalWriteBytesPerSecond: writeRate,
    maximumIoWaitPercent: waitPercent,
    level,
    observationEnabled: observation,
    state: operatingState(environment, observation, processes.length, level),
    confidence: confidence(environment, processes.length, waitPercent, readRate, writeRate),
    recommendations: recommendations(environment, observation, processes.length, level),
    actions: EMPTY_ARRAY
  });
}
