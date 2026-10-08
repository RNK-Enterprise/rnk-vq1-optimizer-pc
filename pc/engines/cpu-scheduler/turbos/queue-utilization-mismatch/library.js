/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated queue-utilization-mismatch turbo library. It validates and
 * aggregates alignment reports without importing the turbo or engine.
 */

export const CPU_SCHEDULER_MISMATCH_LIBRARY_ID = 'cpu-scheduler.queue-utilization-mismatch.library';
export const CPU_SCHEDULER_MISMATCH_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'aligned-window',
  'rising-mismatch',
  'mismatch-burst',
  'busy-low-queue',
  'queued-low-utilization',
  'no-observation',
  'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, lower, upper) {
  return Number.isFinite(value) && value >= lower && value <= upper;
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Queue-utilization-mismatch library report must be an object');
  if (report.turbo !== 'cpu-scheduler.queue-utilization-mismatch') {
    throw new Error('Queue-utilization-mismatch library requires a mismatch turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('Queue-utilization-mismatch library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Queue-utilization-mismatch library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.observedCount) || report.observedCount < 0
    || report.observedCount > report.sampleCount) {
    throw new RangeError('Queue-utilization-mismatch library report observedCount must fit inside sampleCount');
  }
  if (!Number.isInteger(report.queuedLowUtilizationCount) || report.queuedLowUtilizationCount < 0
    || report.queuedLowUtilizationCount > report.sampleCount) {
    throw new RangeError('Queue-utilization-mismatch library report queued count must fit inside sampleCount');
  }
  if (!Number.isInteger(report.busyLowQueueCount) || report.busyLowQueueCount < 0
    || report.busyLowQueueCount > report.sampleCount) {
    throw new RangeError('Queue-utilization-mismatch library report busy count must fit inside sampleCount');
  }
  if (!bounded(report.mismatchRate, 0, 1)) {
    throw new RangeError('Queue-utilization-mismatch library report mismatchRate must be between 0 and 1');
  }
  if (report.peakMismatch !== null && !bounded(report.peakMismatch, 0, 1)) {
    throw new RangeError('Queue-utilization-mismatch library report peak must be null or between 0 and 1');
  }
  if (report.meanMismatch !== null && !bounded(report.meanMismatch, 0, 1)) {
    throw new RangeError('Queue-utilization-mismatch library report mean must be null or between 0 and 1');
  }
  if (!bounded(report.maximumRise, 0, 1)) {
    throw new RangeError('Queue-utilization-mismatch library report maximumRise must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) {
    throw new TypeError('Queue-utilization-mismatch library reports must be an array');
  }
  if (reports.length > 64) {
    throw new RangeError('Queue-utilization-mismatch library accepts at most 64 reports');
  }
  return Object.freeze(reports.map(requireReport));
}

function weightedAverage(reports, selector) {
  const usable = reports.filter((report) => selector(report) !== null);
  if (usable.length === 0) return null;
  const totalWeight = usable.reduce((sum, report) => sum + Math.max(1, report.sampleCount), 0);
  const total = usable.reduce((sum, report) => (
    sum + selector(report) * Math.max(1, report.sampleCount)
  ), 0);
  return Math.round((total / totalWeight) * 10000) / 10000;
}

function maximum(reports, selector) {
  const values = reports.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'queued-low-utilization')) return 'queued-low-utilization';
  if (reports.some((report) => report.state === 'busy-low-queue')) return 'busy-low-queue';
  if (reports.some((report) => report.state === 'mismatch-burst')) return 'mismatch-burst';
  if (reports.some((report) => report.state === 'rising-mismatch')) return 'rising-mismatch';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  return reports.some((report) => report.state === 'aligned-window')
    ? 'aligned-window'
    : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'queued-low-utilization') return Object.freeze(['review-queue-or-idle-accounting']);
  if (state === 'busy-low-queue') return Object.freeze(['review-utilization-or-queue-accounting']);
  if (state === 'mismatch-burst') return Object.freeze(['observe-queue-utilization-alignment']);
  if (state === 'rising-mismatch') return Object.freeze(['observe-next-queue-utilization-sample']);
  if (state === 'no-observation') return Object.freeze(['request-queue-utilization-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-scheduler-samples']);
  return Object.freeze(['no-change']);
}

export function mergeCpuSchedulerQueueUtilizationReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_SCHEDULER_MISMATCH_LIBRARY_ID,
    libraryVersion: CPU_SCHEDULER_MISMATCH_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    mismatchRate: weightedAverage(validated, (report) => report.mismatchRate),
    peakMismatch: maximum(validated, (report) => report.peakMismatch),
    meanMismatch: weightedAverage(validated, (report) => report.meanMismatch),
    maximumRise: maximum(validated, (report) => report.maximumRise),
    queuedLowUtilizationCount: validated.reduce(
      (sum, report) => sum + report.queuedLowUtilizationCount, 0
    ),
    busyLowQueueCount: validated.reduce((sum, report) => sum + report.busyLowQueueCount, 0),
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'queued-low-utilization') return 'queue-accounting-review';
  if (state === 'busy-low-queue') return 'utilization-accounting-review';
  if (state === 'mismatch-burst') return 'alignment-observation';
  if (state === 'rising-mismatch') return 'trend-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'queued-low-utilization' || state === 'busy-low-queue') return 500;
  if (state === 'mismatch-burst') return 750;
  if (state === 'rising-mismatch') return 1000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function buildCpuSchedulerQueueUtilizationPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_SCHEDULER_MISMATCH_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.observedCount === 0 || validated.sampleCount === 0
      ? 0
      : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Queue-utilization-mismatch library clock must return a number');
  }
  return timestamp;
}

export function buildCpuSchedulerQueueUtilizationEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Queue-utilization-mismatch library trigger is required');
  }
  return Object.freeze({
    library: CPU_SCHEDULER_MISMATCH_LIBRARY_ID,
    libraryVersion: CPU_SCHEDULER_MISMATCH_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuSchedulerQueueUtilizationLibrary() {
  return Object.freeze({
    id: CPU_SCHEDULER_MISMATCH_LIBRARY_ID,
    version: CPU_SCHEDULER_MISMATCH_LIBRARY_VERSION,
    merge: mergeCpuSchedulerQueueUtilizationReports,
    plan: buildCpuSchedulerQueueUtilizationPlan,
    envelope: buildCpuSchedulerQueueUtilizationEnvelope
  });
}
