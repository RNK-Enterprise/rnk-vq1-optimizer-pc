/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * State-coverage turbo. It measures documented process-state coverage
 * without terminating, restarting, or changing a process.
 */

export const PROCESS_LIFECYCLE_STATE_COVERAGE_TURBO_ID = 'process-lifecycle.state-coverage';
export const PROCESS_LIFECYCLE_STATE_COVERAGE_TURBO_VERSION = 1;
export const PROCESS_LIFECYCLE_STATE_COVERAGE_TRIGGERS = Object.freeze([
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

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('State-coverage snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('State-coverage requires a system-facts snapshot');
  if (!Array.isArray(snapshot.processes)) throw new TypeError('State-coverage snapshot requires a process list');
  return snapshot;
}

function requireTrigger(trigger) {
  if (!PROCESS_LIFECYCLE_STATE_COVERAGE_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported state-coverage trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('State-coverage windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('State-coverage minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`State-coverage ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('State-coverage coverageThreshold must be between 0 and 1');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('State-coverage clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function aggregate(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = source.processes.filter(isRecord).map((process) => stateOf(process.state));
  if (!environmentKnown(source)) return Object.freeze({ state: 'incomplete', processCount: rows.length, knownCount: 0, coverage: 0 });
  if (rows.length === 0) return Object.freeze({ state: 'no-processes', processCount: 0, knownCount: 0, coverage: 0 });
  const knownCount = rows.filter((state) => state !== 'unknown').length;
  return Object.freeze({
    state: 'observed', processCount: rows.length, knownCount, coverage: knownCount / rows.length
  });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, lowCoverageCount,
  persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-processes')) return 'no-processes';
  if (incompleteCount > 0) return 'incomplete-state-evidence';
  if (lowCoverageCount >= persistenceThreshold) return 'state-coverage-low-sustained';
  if (lowCoverageCount > 0) return 'state-coverage-low-observed';
  return 'complete-state-observation';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-state-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-lifecycle-review']);
  if (state === 'incomplete-state-evidence') return Object.freeze(['request-process-state-observation']);
  if (state === 'state-coverage-low-sustained') return Object.freeze(['review-process-state-coverage', 'hold-unknown-state-policy']);
  if (state === 'state-coverage-low-observed') return Object.freeze(['observe-next-state-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runProcessLifecycleStateCoverageTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  coverageThreshold = 1,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('State-coverage samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredCoverage = requireThreshold(coverageThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(aggregate);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noProcessCount = evidence.filter((item) => item.state === 'no-processes').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const lowCoverageCount = evidence.filter((item) => item.state === 'observed'
    && item.coverage < requiredCoverage).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount,
    lowCoverageCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ processCount: 0, knownCount: 0, coverage: 0 });
  return Object.freeze({
    protocolVersion: 1,
    turbo: PROCESS_LIFECYCLE_STATE_COVERAGE_TURBO_ID,
    turboVersion: PROCESS_LIFECYCLE_STATE_COVERAGE_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    coverageThreshold: requiredCoverage,
    persistenceThreshold: requiredPersistence,
    processCount: latest.processCount,
    knownStateCount: latest.knownCount,
    latestCoverage: latest.coverage,
    observedCount,
    incompleteCount,
    noProcessCount,
    lowCoverageCount,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
