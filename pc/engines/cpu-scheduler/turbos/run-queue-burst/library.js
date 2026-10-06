/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated run-queue-burst turbo library. It validates and aggregates
 * reports without importing the turbo, engine, or any operating-system API.
 */

export const CPU_SCHEDULER_QUEUE_LIBRARY_ID = 'cpu-scheduler.run-queue-burst.library';
export const CPU_SCHEDULER_QUEUE_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-window',
  'rising-pressure',
  'burst-detected',
  'sustained-pressure',
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
  if (!isRecord(report)) throw new TypeError('Run-queue-burst library report must be an object');
  if (report.turbo !== 'cpu-scheduler.run-queue-burst') {
    throw new Error('Run-queue-burst library requires a run-queue-burst turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Run-queue-burst library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Run-queue-burst library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.observedCount) || report.observedCount < 0
    || report.observedCount > report.sampleCount) {
    throw new RangeError('Run-queue-burst library report observedCount must fit inside sampleCount');
  }
  if (!Number.isInteger(report.burstCount) || report.burstCount < 0
    || report.burstCount > report.observedCount) {
    throw new RangeError('Run-queue-burst library report burstCount must fit inside observedCount');
  }
  if (!bounded(report.burstRate, 0, 1)) {
    throw new RangeError('Run-queue-burst library report burstRate must be between 0 and 1');
  }
  if (report.peakPressure !== null && !bounded(report.peakPressure, 0, 16)) {
    throw new RangeError('Run-queue-burst library report peak must be null or between 0 and 16');
  }
  if (report.meanPressure !== null && !bounded(report.meanPressure, 0, 16)) {
    throw new RangeError('Run-queue-burst library report mean must be null or between 0 and 16');
  }
  if (!bounded(report.maximumRise, 0, 16)) {
    throw new RangeError('Run-queue-burst library report maximumRise must be between 0 and 16');
  }
  if (!Number.isInteger(report.longestHighRun) || report.longestHighRun < 0
    || report.longestHighRun > report.sampleCount) {
    throw new RangeError('Run-queue-burst library report longestHighRun must fit inside sampleCount');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Run-queue-burst library reports must be an array');
  if (reports.length > 64) throw new RangeError('Run-queue-burst library accepts at most 64 reports');
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
  if (reports.some((report) => report.state === 'sustained-pressure')) return 'sustained-pressure';
  if (reports.some((report) => report.state === 'burst-detected')) return 'burst-detected';
  if (reports.some((report) => report.state === 'rising-pressure')) return 'rising-pressure';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  return reports.some((report) => report.state === 'stable-window')
    ? 'stable-window'
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
  if (state === 'sustained-pressure') return Object.freeze(['protect-scheduler-headroom']);
  if (state === 'burst-detected') return Object.freeze(['observe-run-queue-duration']);
  if (state === 'rising-pressure') return Object.freeze(['observe-next-scheduler-sample']);
  if (state === 'no-observation') return Object.freeze(['request-scheduler-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-scheduler-samples']);
  return Object.freeze(['no-change']);
}

export function mergeCpuSchedulerRunQueueReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_SCHEDULER_QUEUE_LIBRARY_ID,
    libraryVersion: CPU_SCHEDULER_QUEUE_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    burstRate: weightedAverage(validated, (report) => report.burstRate),
    peakPressure: maximum(validated, (report) => report.peakPressure),
    meanPressure: weightedAverage(validated, (report) => report.meanPressure),
    maximumRise: maximum(validated, (report) => report.maximumRise),
    longestHighRun: maximum(validated, (report) => report.longestHighRun),
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    burstCount: validated.reduce((sum, report) => sum + report.burstCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'sustained-pressure') return 'headroom-protection';
  if (state === 'burst-detected') return 'burst-observation';
  if (state === 'rising-pressure') return 'trend-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'sustained-pressure') return 250;
  if (state === 'burst-detected') return 500;
  if (state === 'rising-pressure') return 750;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function buildCpuSchedulerRunQueuePlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_SCHEDULER_QUEUE_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Run-queue-burst library clock must return a number');
  return timestamp;
}

export function buildCpuSchedulerRunQueueEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Run-queue-burst library trigger is required');
  }
  return Object.freeze({
    library: CPU_SCHEDULER_QUEUE_LIBRARY_ID,
    libraryVersion: CPU_SCHEDULER_QUEUE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuSchedulerRunQueueLibrary() {
  return Object.freeze({
    id: CPU_SCHEDULER_QUEUE_LIBRARY_ID,
    version: CPU_SCHEDULER_QUEUE_LIBRARY_VERSION,
    merge: mergeCpuSchedulerRunQueueReports,
    plan: buildCpuSchedulerRunQueuePlan,
    envelope: buildCpuSchedulerRunQueueEnvelope
  });
}
