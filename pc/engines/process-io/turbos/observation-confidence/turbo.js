/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Observation-confidence turbo. It measures process I/O metric completeness
 * without changing processes, files, or transport state.
 */

export const PROCESS_IO_OBSERVATION_CONFIDENCE_TURBO_ID = 'process-io.observation-confidence';
export const PROCESS_IO_OBSERVATION_CONFIDENCE_TURBO_VERSION = 1;
export const PROCESS_IO_OBSERVATION_CONFIDENCE_TRIGGERS = Object.freeze([
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

function observed(value) {
  return Number.isFinite(value) && value >= 0;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Observation-confidence snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Observation-confidence requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.processes)) {
    throw new TypeError('Observation-confidence snapshot requires a process list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!PROCESS_IO_OBSERVATION_CONFIDENCE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported observation-confidence trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Observation-confidence windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Observation-confidence minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Observation-confidence ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('Observation-confidence completenessThreshold must be between 0 and 1');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Observation-confidence clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function aggregate(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.processes.filter(isRecord);
  if (!environmentKnown(source)) {
    return Object.freeze({ state: 'incomplete', processCount: rows.length, completeCount: 0, observationRate: 0 });
  }
  if (rows.length === 0) {
    return Object.freeze({ state: 'no-processes', processCount: 0, completeCount: 0, observationRate: 0 });
  }
  if (source.capabilities?.processIoObservation === false) {
    return Object.freeze({ state: 'observation-disabled', processCount: rows.length, completeCount: 0, observationRate: 0 });
  }
  const completeCount = rows.filter((process) => (
    observed(process.ioReadBytesPerSecond)
    && observed(process.ioWriteBytesPerSecond)
    && observed(process.ioWaitPercent)
  )).length;
  return Object.freeze({
    state: 'observed',
    processCount: rows.length,
    completeCount,
    observationRate: completeCount / rows.length
  });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, disabledCount,
  lowConfidenceCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-processes')) return 'no-processes';
  if (disabledCount > 0) return 'observation-disabled';
  if (incompleteCount > 0) return 'incomplete-confidence-evidence';
  if (lowConfidenceCount >= persistenceThreshold) return 'low-confidence-sustained';
  if (lowConfidenceCount > 0) return 'low-confidence-observed';
  return 'complete-observation';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-process-io-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-io-review']);
  if (state === 'observation-disabled') return Object.freeze(['keep-process-io-observation-disabled']);
  if (state === 'incomplete-confidence-evidence') return Object.freeze(['request-process-io-observation']);
  if (state === 'low-confidence-sustained') {
    return Object.freeze(['review-process-io-sensor-coverage', 'hold-unapproved-io-policy']);
  }
  if (state === 'low-confidence-observed') return Object.freeze(['observe-next-process-io-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runProcessIoObservationConfidenceTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  completenessThreshold = 0.8,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Observation-confidence samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredThreshold = requireThreshold(completenessThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(aggregate);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const disabledCount = evidence.filter((item) => item.state === 'observation-disabled').length;
  const noProcessCount = evidence.filter((item) => item.state === 'no-processes').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const lowConfidenceCount = evidence.filter((item) => item.state === 'observed'
    && item.observationRate < requiredThreshold).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, disabledCount,
    lowConfidenceCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ processCount: 0, completeCount: 0, observationRate: 0 });
  return Object.freeze({
    protocolVersion: 1,
    turbo: PROCESS_IO_OBSERVATION_CONFIDENCE_TURBO_ID,
    turboVersion: PROCESS_IO_OBSERVATION_CONFIDENCE_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    completenessThreshold: requiredThreshold,
    persistenceThreshold: requiredPersistence,
    processCount: latest.processCount,
    completeProcessCount: latest.completeCount,
    latestObservationRate: latest.observationRate,
    observedCount,
    incompleteCount,
    disabledCount,
    noProcessCount,
    lowConfidenceCount,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
