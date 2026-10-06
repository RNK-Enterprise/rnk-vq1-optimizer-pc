/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated foreground-protection library. It validates, aggregates, and
 * plans protection reports without importing the turbo or changing process
 * state.
 */

export const PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_ID = 'process-priority.foreground-protection.library';
export const PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'foreground-elevated-sustained', 'foreground-elevated-observed',
  'unprotected-foreground', 'protected-foreground', 'no-foreground',
  'no-processes', 'incomplete-protection-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Foreground-protection library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireNonNegative(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) {
    throw new RangeError(`Foreground-protection library report ${label} must be from 0 to 4096`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Foreground-protection library report must be an object');
  if (report.turbo !== 'process-priority.foreground-protection') {
    throw new Error('Foreground-protection library requires a foreground-protection turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('Foreground-protection library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Foreground-protection library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Foreground-protection library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Foreground-protection library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noProcessCount', 'no-process count'], ['elevatedSamples', 'elevated sample count'],
    ['unprotectedSamples', 'unprotected sample count']
  ]) requireSampleCount(report, field, label);
  for (const [field, label] of [
    ['processCount', 'process count'], ['foregroundCount', 'foreground count'],
    ['protectedForegroundCount', 'protected foreground count'],
    ['elevatedForegroundCount', 'elevated foreground count'],
    ['unprotectedForegroundCount', 'unprotected foreground count']
  ]) requireNonNegative(report, field, label);
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Foreground-protection library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Foreground-protection library reports must be an array');
  if (reports.length > 64) throw new RangeError('Foreground-protection library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-processes')) return 'no-processes';
  if (reports.some((report) => report.state === 'incomplete-protection-evidence')) {
    return 'incomplete-protection-evidence';
  }
  if (reports.some((report) => report.state === 'foreground-elevated-sustained')) {
    return 'foreground-elevated-sustained';
  }
  if (reports.some((report) => report.state === 'foreground-elevated-observed')) {
    return 'foreground-elevated-observed';
  }
  if (reports.some((report) => report.state === 'unprotected-foreground')) return 'unprotected-foreground';
  if (reports.some((report) => report.state === 'protected-foreground')) return 'protected-foreground';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'no-foreground';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
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

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'foreground-elevated-sustained') return 'foreground-elevation-review';
  if (state === 'foreground-elevated-observed') return 'foreground-elevation-observation';
  if (state === 'unprotected-foreground') return 'foreground-protection-review';
  if (state === 'protected-foreground') return 'protected-foreground-observation';
  if (state === 'no-processes') return 'no-process-observation';
  if (state === 'incomplete-protection-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'foreground-observation';
}

function intervalFor(state, environment) {
  if (state === 'foreground-elevated-sustained') return 750;
  if (state === 'foreground-elevated-observed') return 1000;
  if (state === 'unprotected-foreground') return 1000;
  if (state === 'protected-foreground') return 5000;
  if (state === 'no-processes') return 10000;
  if (state === 'incomplete-protection-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || {
    processCount: 0, foregroundCount: 0, protectedForegroundCount: 0,
    elevatedForegroundCount: 0, unprotectedForegroundCount: 0
  };
}

export function mergeProcessPriorityForegroundProtectionReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_ID,
    libraryVersion: PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    processCount: last.processCount,
    foregroundCount: last.foregroundCount,
    protectedForegroundCount: last.protectedForegroundCount,
    elevatedForegroundCount: last.elevatedForegroundCount,
    unprotectedForegroundCount: last.unprotectedForegroundCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noProcessCount: validated.reduce((sum, report) => sum + report.noProcessCount, 0),
    elevatedSamples: validated.reduce((sum, report) => sum + report.elevatedSamples, 0),
    unprotectedSamples: validated.reduce((sum, report) => sum + report.unprotectedSamples, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildProcessPriorityForegroundProtectionPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0 ? 0
      : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Foreground-protection library clock must return a number');
  return timestamp;
}

export function buildProcessPriorityForegroundProtectionEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Foreground-protection library trigger is required');
  }
  return Object.freeze({
    library: PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_ID,
    libraryVersion: PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createProcessPriorityForegroundProtectionLibrary() {
  return Object.freeze({
    id: PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_ID,
    version: PROCESS_PRIORITY_FOREGROUND_PROTECTION_LIBRARY_VERSION,
    merge: mergeProcessPriorityForegroundProtectionReports,
    plan: buildProcessPriorityForegroundProtectionPlan,
    envelope: buildProcessPriorityForegroundProtectionEnvelope
  });
}
