/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Foreground-protection turbo. It evaluates foreground, elevated, and
 * protected process observations without changing process state or transport.
 */

export const PROCESS_PRIORITY_FOREGROUND_PROTECTION_TURBO_ID = 'process-priority.foreground-protection';
export const PROCESS_PRIORITY_FOREGROUND_PROTECTION_TURBO_VERSION = 1;
export const PROCESS_PRIORITY_FOREGROUND_PROTECTION_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const PRIORITIES = Object.freeze(['idle', 'below-normal', 'normal', 'above-normal', 'high', 'realtime']);
const ELEVATED = Object.freeze(['above-normal', 'high', 'realtime']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function priorityOf(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
  const normalized = value.trim().toLowerCase();
  return PRIORITIES.includes(normalized) ? normalized : 'unknown';
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Foreground-protection snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('Foreground-protection requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.processes)) {
    throw new TypeError('Foreground-protection snapshot requires a process list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!PROCESS_PRIORITY_FOREGROUND_PROTECTION_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported foreground-protection trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('Foreground-protection windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('Foreground-protection minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`Foreground-protection ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Foreground-protection clock must return a number');
  return timestamp;
}

function environmentKnown(snapshot) {
  return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown';
}

function processRows(snapshot) {
  return snapshot.processes.filter(isRecord).map((process) => ({
    priority: priorityOf(process.priority),
    foreground: process.foreground === true,
    protected: process.protected === true
  }));
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const rows = processRows(source);
  if (!environmentKnown(source)) {
    return Object.freeze({
      state: 'incomplete', processCount: rows.length, foregroundCount: 0,
      protectedForegroundCount: 0, elevatedForegroundCount: 0, unprotectedForegroundCount: 0
    });
  }
  if (rows.length === 0) {
    return Object.freeze({
      state: 'no-processes', processCount: 0, foregroundCount: 0,
      protectedForegroundCount: 0, elevatedForegroundCount: 0, unprotectedForegroundCount: 0
    });
  }
  if (rows.some((row) => row.priority === 'unknown')) {
    return Object.freeze({
      state: 'incomplete', processCount: rows.length, foregroundCount: 0,
      protectedForegroundCount: 0, elevatedForegroundCount: 0, unprotectedForegroundCount: 0
    });
  }
  const foreground = rows.filter((row) => row.foreground);
  const protectedForeground = foreground.filter((row) => row.protected);
  const elevatedForeground = foreground.filter((row) => ELEVATED.includes(row.priority));
  const unprotectedForeground = foreground.filter((row) => !row.protected);
  return Object.freeze({
    state: 'observed',
    processCount: rows.length,
    foregroundCount: foreground.length,
    protectedForegroundCount: protectedForeground.length,
    elevatedForegroundCount: elevatedForeground.length,
    unprotectedForegroundCount: unprotectedForeground.length
  });
}

function persistence(evidence) {
  return {
    elevatedSamples: evidence.filter((item) => item.state === 'observed' && item.elevatedForegroundCount > 0).length,
    unprotectedSamples: evidence.filter((item) => item.state === 'observed' && item.unprotectedForegroundCount > 0).length
  };
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, trend, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-processes')) return 'no-processes';
  if (incompleteCount > 0) return 'incomplete-protection-evidence';
  if (trend.elevatedSamples >= persistenceThreshold) return 'foreground-elevated-sustained';
  if (trend.elevatedSamples > 0) return 'foreground-elevated-observed';
  if (trend.unprotectedSamples > 0) return 'unprotected-foreground';
  if (evidence.some((item) => item.protectedForegroundCount > 0)) return 'protected-foreground';
  return 'no-foreground';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-foreground-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-protection-review']);
  if (state === 'incomplete-protection-evidence') {
    return Object.freeze(['request-documented-protection-observation']);
  }
  if (state === 'foreground-elevated-sustained') {
    return Object.freeze(['review-foreground-elevation', 'hold-unapproved-priority-policy']);
  }
  if (state === 'foreground-elevated-observed') return Object.freeze(['observe-next-foreground-sample']);
  if (state === 'unprotected-foreground') return Object.freeze(['review-foreground-protection']);
  if (state === 'protected-foreground') return Object.freeze(['preserve-user-owned-protection']);
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, observedCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((observedCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

export function runProcessPriorityForegroundProtectionTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Foreground-protection samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noProcessCount = evidence.filter((item) => item.state === 'no-processes').length;
  const observedCount = evidence.filter((item) => item.state === 'observed').length;
  const trend = persistence(evidence);
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, trend,
    requiredPersistence);
  const latest = evidence.at(-1) || Object.freeze({
    processCount: 0, foregroundCount: 0, protectedForegroundCount: 0,
    elevatedForegroundCount: 0, unprotectedForegroundCount: 0
  });
  return Object.freeze({
    protocolVersion: 1,
    turbo: PROCESS_PRIORITY_FOREGROUND_PROTECTION_TURBO_ID,
    turboVersion: PROCESS_PRIORITY_FOREGROUND_PROTECTION_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    processCount: latest.processCount,
    foregroundCount: latest.foregroundCount,
    protectedForegroundCount: latest.protectedForegroundCount,
    elevatedForegroundCount: latest.elevatedForegroundCount,
    unprotectedForegroundCount: latest.unprotectedForegroundCount,
    observedCount,
    incompleteCount,
    noProcessCount,
    elevatedSamples: trend.elevatedSamples,
    unprotectedSamples: trend.unprotectedSamples,
    state,
    confidence: confidence(selected.length, observedCount, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
