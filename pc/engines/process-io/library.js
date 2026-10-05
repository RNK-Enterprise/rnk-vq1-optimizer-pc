/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Process-I/O library. It aggregates bounded observations for review and
 * never throttles, terminates, renices, or changes files.
 */

export const PROCESS_IO_LIBRARY_ID = 'process-io-library';
export const PROCESS_IO_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

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
  if (!isRecord(facts)) throw new TypeError('Process-I/O library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Process-I/O library requires normalized system facts');
  }
  if (!Array.isArray(facts.processes)) throw new TypeError('Process-I/O library requires a process list');
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

function levelFor(waitPercent, readRate, writeRate) {
  if (waitPercent === null && readRate === null && writeRate === null) return 'unknown';
  if (waitPercent !== null && waitPercent >= 30) return 'high';
  if (waitPercent !== null && waitPercent >= 10) return 'elevated';
  return 'normal';
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

function observationEnabled(capabilities) {
  return !(isRecord(capabilities) && capabilities.processIoObservation === false);
}

export function classifyProcessIo(facts) {
  const source = requireFacts(facts);
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
  const observation = observationEnabled(source.capabilities);
  return Object.freeze({
    library: PROCESS_IO_LIBRARY_ID,
    libraryVersion: PROCESS_IO_LIBRARY_VERSION,
    environment,
    processCount: processes.length,
    names: Object.freeze(processes.map((process) => process.name).filter(Boolean)),
    totalReadBytesPerSecond: readRate,
    totalWriteBytesPerSecond: writeRate,
    maximumIoWaitPercent: waitPercent,
    level,
    observationEnabled: observation,
    recommendations: recommendations(environment, observation, processes.length, level)
  });
}

export function compareProcessIo(previous, current) {
  const before = classifyProcessIo(previous);
  const after = classifyProcessIo(current);
  const levelChanged = before.level !== after.level;
  const readChanged = before.totalReadBytesPerSecond !== after.totalReadBytesPerSecond;
  const writeChanged = before.totalWriteBytesPerSecond !== after.totalWriteBytesPerSecond;
  const waitChanged = before.maximumIoWaitPercent !== after.maximumIoWaitPercent;
  return Object.freeze({
    changed: levelChanged || readChanged || writeChanged || waitChanged,
    levelChanged,
    readChanged,
    writeChanged,
    waitChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Process-I/O library clock must return a number');
  return timestamp;
}

export function buildProcessIoEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Process-I/O library trigger is required');
  }
  return Object.freeze({
    library: PROCESS_IO_LIBRARY_ID,
    libraryVersion: PROCESS_IO_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyProcessIo(facts)
  });
}

export function createProcessIoLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Process-I/O library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: PROCESS_IO_LIBRARY_ID,
    version: PROCESS_IO_LIBRARY_VERSION,
    classify: classifyProcessIo,
    compare: compareProcessIo,
    envelope: (facts, envelopeOptions = {}) => buildProcessIoEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
