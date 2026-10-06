/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Service-contention turbo. It observes bounded service-process I/O pressure
 * without throttling, terminating, or changing processes or files.
 */

export const PROCESS_IO_SERVICE_CONTENTION_TURBO_ID = 'process-io.service-contention';
export const PROCESS_IO_SERVICE_CONTENTION_TURBO_VERSION = 1;
export const PROCESS_IO_SERVICE_CONTENTION_TRIGGERS = Object.freeze([
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

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Service-contention snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Service-contention requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.processes)) {
    throw new TypeError('Service-contention snapshot requires a process list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!PROCESS_IO_SERVICE_CONTENTION_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported service-contention trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Service-contention windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Service-contention minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Service-contention ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('Service-contention contentionThreshold must be between 0 and 100');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Service-contention clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function serviceOf(process) {
  return process.service === true || process.role === 'service';
}

function aggregate(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.processes.filter(isRecord).map((process) => ({
    service: serviceOf(process),
    wait: percent(process.ioWaitPercent)
  }));
  if (!environmentKnown(source)) {
    return Object.freeze({ state: 'incomplete', processCount: rows.length, serviceCount: 0, maximumServiceWait: null });
  }
  if (rows.length === 0) {
    return Object.freeze({ state: 'no-processes', processCount: 0, serviceCount: 0, maximumServiceWait: null });
  }
  if (source.capabilities?.processIoObservation === false) {
    return Object.freeze({ state: 'observation-disabled', processCount: rows.length, serviceCount: 0, maximumServiceWait: null });
  }
  const services = rows.filter((row) => row.service);
  if (services.length === 0) {
    return Object.freeze({ state: 'observed', processCount: rows.length, serviceCount: 0, maximumServiceWait: null });
  }
  const waits = services.map((row) => row.wait).filter((value) => value !== null);
  if (waits.length === 0) {
    return Object.freeze({ state: 'incomplete', processCount: rows.length, serviceCount: services.length, maximumServiceWait: null });
  }
  return Object.freeze({
    state: 'observed',
    processCount: rows.length,
    serviceCount: services.length,
    maximumServiceWait: Math.max(...waits)
  });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, disabledCount,
  contentionCount, serviceSampleCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-processes')) return 'no-processes';
  if (disabledCount > 0) return 'observation-disabled';
  if (incompleteCount > 0) return 'incomplete-service-evidence';
  if (contentionCount >= persistenceThreshold) return 'service-contention-sustained';
  if (contentionCount > 0) return 'service-contention-observed';
  if (serviceSampleCount === 0) return 'no-services';
  return 'service-contention-clear';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-service-io-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-io-review']);
  if (state === 'observation-disabled') return Object.freeze(['keep-process-io-observation-disabled']);
  if (state === 'incomplete-service-evidence') return Object.freeze(['request-service-io-observation']);
  if (state === 'service-contention-sustained') {
    return Object.freeze(['protect-services', 'review-service-storage-contention']);
  }
  if (state === 'service-contention-observed') return Object.freeze(['observe-next-service-sample']);
  if (state === 'no-services') return Object.freeze(['request-service-role-observation']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runProcessIoServiceContentionTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  contentionThreshold = 30,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Service-contention samples must be an array');
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
  const contentionCount = evidence.filter((item) => item.maximumServiceWait !== null
    && item.maximumServiceWait >= requiredThreshold).length;
  const serviceSampleCount = evidence.filter((item) => item.serviceCount > 0).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, disabledCount,
    contentionCount, serviceSampleCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ processCount: 0, serviceCount: 0, maximumServiceWait: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: PROCESS_IO_SERVICE_CONTENTION_TURBO_ID,
    turboVersion: PROCESS_IO_SERVICE_CONTENTION_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    contentionThreshold: requiredThreshold,
    persistenceThreshold: requiredPersistence,
    processCount: latest.processCount,
    serviceCount: latest.serviceCount,
    maximumServiceWaitPercent: latest.maximumServiceWait,
    observedCount,
    incompleteCount,
    disabledCount,
    noProcessCount,
    contentionCount,
    serviceSampleCount,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
