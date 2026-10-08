/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Uptime-churn turbo. It observes bounded short-lived process evidence
 * without restarting, terminating, or changing a process.
 */

export const PROCESS_LIFECYCLE_UPTIME_CHURN_TURBO_ID = 'process-lifecycle.uptime-churn';
export const PROCESS_LIFECYCLE_UPTIME_CHURN_TURBO_VERSION = 1;
export const PROCESS_LIFECYCLE_UPTIME_CHURN_TRIGGERS = Object.freeze([
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
  if (!isRecord(snapshot)) throw new TypeError('Uptime-churn snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Uptime-churn requires a system-facts snapshot');
  if (!Array.isArray(snapshot.processes)) throw new TypeError('Uptime-churn snapshot requires a process list');
  return snapshot;
}

function requireTrigger(trigger) {
  if (!PROCESS_LIFECYCLE_UPTIME_CHURN_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported uptime-churn trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Uptime-churn windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Uptime-churn minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Uptime-churn ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireThreshold(value) {
  if (!Number.isFinite(value) || value < 0 || value > 86400) {
    throw new RangeError('Uptime-churn shortLivedThreshold must be between 0 and 86400');
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Uptime-churn clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function aggregate(snapshot, shortLivedThreshold) {
  const source = requireSnapshot(snapshot);
  const rows = source.processes.filter(isRecord).map((process) => nonNegative(process.uptimeSeconds));
  if (!environmentKnown(source)) return Object.freeze({ state: 'incomplete', processCount: rows.length, shortLivedCount: 0, maximumUptime: null });
  if (rows.length === 0) return Object.freeze({ state: 'no-processes', processCount: 0, shortLivedCount: 0, maximumUptime: null });
  if (rows.some((uptime) => uptime === null)) return Object.freeze({ state: 'incomplete', processCount: rows.length, shortLivedCount: 0, maximumUptime: null });
  return Object.freeze({
    state: 'observed', processCount: rows.length,
    shortLivedCount: rows.filter((uptime) => uptime <= shortLivedThreshold).length,
    maximumUptime: Math.max(...rows)
  });
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, shortLivedSampleCount,
  persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-processes')) return 'no-processes';
  if (incompleteCount > 0) return 'incomplete-uptime-evidence';
  if (shortLivedSampleCount >= persistenceThreshold) return 'short-lived-sustained';
  if (shortLivedSampleCount > 0) return 'short-lived-observed';
  return 'stable-uptime';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-uptime-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-lifecycle-review']);
  if (state === 'incomplete-uptime-evidence') return Object.freeze(['request-uptime-observation']);
  if (state === 'short-lived-sustained') return Object.freeze(['review-process-churn', 'hold-restart-policy']);
  if (state === 'short-lived-observed') return Object.freeze(['observe-next-uptime-sample']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runProcessLifecycleUptimeChurnTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  shortLivedThreshold = 60,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Uptime-churn samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredThreshold = requireThreshold(shortLivedThreshold);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map((sample) => aggregate(sample, requiredThreshold));
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noProcessCount = evidence.filter((item) => item.state === 'no-processes').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const shortLivedSampleCount = evidence.filter((item) => item.state === 'observed'
    && item.shortLivedCount > 0).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount,
    shortLivedSampleCount, requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({ processCount: 0, shortLivedCount: 0, maximumUptime: null });
  return Object.freeze({
    protocolVersion: 1,
    turbo: PROCESS_LIFECYCLE_UPTIME_CHURN_TURBO_ID,
    turboVersion: PROCESS_LIFECYCLE_UPTIME_CHURN_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    shortLivedThreshold: requiredThreshold,
    persistenceThreshold: requiredPersistence,
    processCount: latest.processCount,
    shortLivedCount: latest.shortLivedCount,
    maximumUptimeSeconds: latest.maximumUptime,
    observedCount,
    incompleteCount,
    noProcessCount,
    shortLivedSampleCount,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
