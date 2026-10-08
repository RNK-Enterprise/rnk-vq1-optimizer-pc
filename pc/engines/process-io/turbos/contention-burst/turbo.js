/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Process-I/O contention-burst turbo. It observes bounded I/O wait bursts
 * without throttling processes, changing files, or opening transport.
 */

export const PROCESS_IO_CONTENTION_BURST_TURBO_ID = 'process-io.contention-burst';
export const PROCESS_IO_CONTENTION_BURST_TURBO_VERSION = 1;
export const PROCESS_IO_CONTENTION_BURST_TRIGGERS = Object.freeze([
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

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Contention-burst snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Contention-burst requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.processes)) {
    throw new TypeError('Contention-burst snapshot requires a process list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!PROCESS_IO_CONTENTION_BURST_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported contention-burst trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Contention-burst windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Contention-burst minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Contention-burst ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('Contention-burst contentionThreshold must be between 0 and 100');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Contention-burst clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function aggregate(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.processes.filter(isRecord).map((process) => ({
    readRate: nonNegative(process.ioReadBytesPerSecond),
    writeRate: nonNegative(process.ioWriteBytesPerSecond),
    waitPercent: percent(process.ioWaitPercent)
  }));
  if (!environmentKnown(source)) {
    return Object.freeze({ state: 'incomplete', processCount: rows.length, maximumWait: null, totalRead: null, totalWrite: null });
  }
  if (rows.length === 0) {
    return Object.freeze({ state: 'no-processes', processCount: 0, maximumWait: null, totalRead: null, totalWrite: null });
  }
  if (source.capabilities?.processIoObservation === false) {
    return Object.freeze({ state: 'observation-disabled', processCount: rows.length, maximumWait: null, totalRead: null, totalWrite: null });
  }
  const waits = rows.map((row) => row.waitPercent).filter((value) => value !== null);
  if (waits.length === 0) {
    return Object.freeze({ state: 'incomplete', processCount: rows.length, maximumWait: null, totalRead: null, totalWrite: null });
  }
  const reads = rows.map((row) => row.readRate).filter((value) => value !== null);
  const writes = rows.map((row) => row.writeRate).filter((value) => value !== null);
  return Object.freeze({
    state: 'observed',
    processCount: rows.length,
    maximumWait: Math.max(...waits),
    totalRead: reads.length === 0 ? null : reads.reduce((sum, value) => sum + value, 0),
    totalWrite: writes.length === 0 ? null : writes.reduce((sum, value) => sum + value, 0)
  });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, disabledCount,
  contentionCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-processes')) return 'no-processes';
  if (disabledCount > 0) return 'observation-disabled';
  if (incompleteCount > 0) return 'incomplete-contention-evidence';
  if (contentionCount >= persistenceThreshold) return 'contention-sustained';
  if (contentionCount > 0) return 'contention-observed';
  return 'stable-contention';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-contention-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-io-review']);
  if (state === 'observation-disabled') return Object.freeze(['keep-process-io-observation-disabled']);
  if (state === 'incomplete-contention-evidence') return Object.freeze(['request-process-io-observation']);
  if (state === 'contention-sustained') {
    return Object.freeze(['protect-services', 'review-storage-contention']);
  }
  if (state === 'contention-observed') return Object.freeze(['observe-next-contention-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runProcessIoContentionBurstTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  contentionThreshold = 30,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Contention-burst samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredThreshold = requireThreshold(contentionThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(aggregate);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const disabledCount = evidence.filter((item) => item.state === 'observation-disabled').length;
  const noProcessCount = evidence.filter((item) => item.state === 'no-processes').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const contentionCount = evidence.filter((item) => item.maximumWait !== null
    && item.maximumWait >= requiredThreshold).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, disabledCount,
    contentionCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ processCount: 0, maximumWait: null, totalRead: null, totalWrite: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: PROCESS_IO_CONTENTION_BURST_TURBO_ID,
    turboVersion: PROCESS_IO_CONTENTION_BURST_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    contentionThreshold: requiredThreshold,
    persistenceThreshold: requiredPersistence,
    processCount: latest.processCount,
    maximumWaitPercent: latest.maximumWait,
    totalReadBytesPerSecond: latest.totalRead,
    totalWriteBytesPerSecond: latest.totalWrite,
    observedCount,
    incompleteCount,
    disabledCount,
    noProcessCount,
    contentionCount,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
