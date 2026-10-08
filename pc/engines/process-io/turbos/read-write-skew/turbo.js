/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Read-write-skew turbo. It compares bounded process I/O direction without
 * throttling processes, changing files, or opening transport.
 */

export const PROCESS_IO_READ_WRITE_SKEW_TURBO_ID = 'process-io.read-write-skew';
export const PROCESS_IO_READ_WRITE_SKEW_TURBO_VERSION = 1;
export const PROCESS_IO_READ_WRITE_SKEW_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('Read-write-skew snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Read-write-skew requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.processes)) {
    throw new TypeError('Read-write-skew snapshot requires a process list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!PROCESS_IO_READ_WRITE_SKEW_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported read-write-skew trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Read-write-skew windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Read-write-skew minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Read-write-skew ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireRatio(value) {
  if (!Number.isFinite(value) || value < 1 || value > 100) {
    throw new RangeError('Read-write-skew skewRatio must be between 1 and 100');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Read-write-skew clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function aggregate(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.processes.filter(isRecord).map((process) => ({
    read: nonNegative(process.ioReadBytesPerSecond),
    write: nonNegative(process.ioWriteBytesPerSecond)
  }));
  if (!environmentKnown(source)) {
    return Object.freeze({ state: 'incomplete', processCount: rows.length, read: null, write: null });
  }
  if (rows.length === 0) {
    return Object.freeze({ state: 'no-processes', processCount: 0, read: null, write: null });
  }
  if (source.capabilities?.processIoObservation === false) {
    return Object.freeze({ state: 'observation-disabled', processCount: rows.length, read: null, write: null });
  }
  const reads = rows.map((row) => row.read).filter((value) => value !== null);
  const writes = rows.map((row) => row.write).filter((value) => value !== null);
  if (reads.length !== rows.length || writes.length !== rows.length) {
    return Object.freeze({ state: 'incomplete', processCount: rows.length, read: null, write: null });
  }
  return Object.freeze({
    state: 'observed',
    processCount: rows.length,
    read: reads.reduce((sum, value) => sum + value, 0),
    write: writes.reduce((sum, value) => sum + value, 0)
  });
}

function directionOf(read, write, ratio) {
  if (read === 0 && write === 0) return 'balanced';
  if (read >= write * ratio) return 'read-dominant';
  if (write >= read * ratio) return 'write-dominant';
  return 'balanced';
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, disabledCount,
  readCount, writeCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-processes')) return 'no-processes';
  if (disabledCount > 0) return 'observation-disabled';
  if (incompleteCount > 0) return 'incomplete-read-write-evidence';
  if (readCount >= persistenceThreshold) return 'read-skew-sustained';
  if (writeCount >= persistenceThreshold) return 'write-skew-sustained';
  if (readCount > 0 || writeCount > 0) return 'io-skew-observed';
  return 'balanced-io';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-read-write-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-io-review']);
  if (state === 'observation-disabled') return Object.freeze(['keep-process-io-observation-disabled']);
  if (state === 'incomplete-read-write-evidence') return Object.freeze(['request-process-io-observation']);
  if (state === 'read-skew-sustained') return Object.freeze(['review-read-contention']);
  if (state === 'write-skew-sustained') return Object.freeze(['review-write-contention']);
  if (state === 'io-skew-observed') return Object.freeze(['observe-next-read-write-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runProcessIoReadWriteSkewTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  skewRatio = 1.5,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Read-write-skew samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredRatio = requireRatio(skewRatio);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(aggregate);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const disabledCount = evidence.filter((item) => item.state === 'observation-disabled').length;
  const noProcessCount = evidence.filter((item) => item.state === 'no-processes').length;
  const observed = evidence.filter((item) => item.state === 'observed');
  const readCount = observed.filter((item) => directionOf(item.read, item.write, requiredRatio)
    === 'read-dominant').length;
  const writeCount = observed.filter((item) => directionOf(item.read, item.write, requiredRatio)
    === 'write-dominant').length;
  const observedCount = observed.length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, disabledCount,
    readCount, writeCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ processCount: 0, read: null, write: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: PROCESS_IO_READ_WRITE_SKEW_TURBO_ID,
    turboVersion: PROCESS_IO_READ_WRITE_SKEW_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    skewRatio: requiredRatio,
    persistenceThreshold: requiredPersistence,
    processCount: latest.processCount,
    totalReadBytesPerSecond: latest.read,
    totalWriteBytesPerSecond: latest.write,
    observedCount,
    incompleteCount,
    disabledCount,
    noProcessCount,
    readSkewCount: readCount,
    writeSkewCount: writeCount,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
