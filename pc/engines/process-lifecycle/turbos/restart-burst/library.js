/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated restart-burst library. It validates, aggregates, and plans
 * restart reports without importing the turbo or changing process state.
 */

export const PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_ID = 'process-lifecycle.restart-burst.library';
export const PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'restart-burst-sustained', 'restart-burst-observed', 'stable-lifecycle',
  'no-processes', 'incomplete-restart-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Restart-burst library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Restart-burst library report must be an object');
  if (report.turbo !== 'process-lifecycle.restart-burst') {
    throw new Error('Restart-burst library requires a restart-burst turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Restart-burst library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Restart-burst library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Restart-burst library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.restartThreshold) || report.restartThreshold < 1 || report.restartThreshold > 4096) {
    throw new RangeError('Restart-burst library restartThreshold must be from 1 to 4096');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Restart-burst library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noProcessCount', 'no-process count'], ['restartSampleCount', 'restart sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.processCount) || report.processCount < 0 || report.processCount > 4096) {
    throw new RangeError('Restart-burst library processCount must be from 0 to 4096');
  }
  if (report.totalRestartCount !== null && (!Number.isFinite(report.totalRestartCount) || report.totalRestartCount < 0)) {
    throw new RangeError('Restart-burst library totalRestartCount must be null or non-negative');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Restart-burst library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Restart-burst library reports must be an array');
  if (reports.length > 64) throw new RangeError('Restart-burst library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-processes')) return 'no-processes';
  if (reports.some((report) => report.state === 'incomplete-restart-evidence')) return 'incomplete-restart-evidence';
  if (reports.some((report) => report.state === 'restart-burst-sustained')) return 'restart-burst-sustained';
  if (reports.some((report) => report.state === 'restart-burst-observed')) return 'restart-burst-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-lifecycle';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-restart-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-lifecycle-review']);
  if (state === 'incomplete-restart-evidence') return Object.freeze(['request-restart-observation']);
  if (state === 'restart-burst-sustained') return Object.freeze(['review-restart-policy', 'hold-unapproved-lifecycle-policy']);
  if (state === 'restart-burst-observed') return Object.freeze(['observe-next-restart-sample']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'restart-burst-sustained') return 'restart-policy-review';
  if (state === 'restart-burst-observed') return 'restart-policy-observation';
  if (state === 'no-processes') return 'no-process-observation';
  if (state === 'incomplete-restart-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-lifecycle-observation';
}

function intervalFor(state, environment) {
  if (state === 'restart-burst-sustained') return 750;
  if (state === 'restart-burst-observed') return 1000;
  if (state === 'no-processes') return 10000;
  if (state === 'incomplete-restart-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { processCount: 0, totalRestartCount: null };
}

export function mergeProcessLifecycleRestartBurstReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_ID,
    libraryVersion: PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    processCount: last.processCount,
    totalRestartCount: last.totalRestartCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noProcessCount: validated.reduce((sum, report) => sum + report.noProcessCount, 0),
    restartSampleCount: validated.reduce((sum, report) => sum + report.restartSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildProcessLifecycleRestartBurstPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Restart-burst library clock must return a number');
  return timestamp;
}

export function buildProcessLifecycleRestartBurstEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Restart-burst library trigger is required');
  }
  return Object.freeze({
    library: PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_ID,
    libraryVersion: PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createProcessLifecycleRestartBurstLibrary() {
  return Object.freeze({
    id: PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_ID,
    version: PROCESS_LIFECYCLE_RESTART_BURST_LIBRARY_VERSION,
    merge: mergeProcessLifecycleRestartBurstReports,
    plan: buildProcessLifecycleRestartBurstPlan,
    envelope: buildProcessLifecycleRestartBurstEnvelope
  });
}
