/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated context-churn turbo library. It validates and aggregates churn
 * reports without importing the turbo, engine, or any operating-system API.
 */

export const CPU_SCHEDULER_CHURN_LIBRARY_ID = 'cpu-scheduler.context-churn.library';
export const CPU_SCHEDULER_CHURN_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-churn',
  'reversal-watch',
  'high-churn',
  'volatile-churn',
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
  if (!isRecord(report)) throw new TypeError('Context-churn library report must be an object');
  if (report.turbo !== 'cpu-scheduler.context-churn') {
    throw new Error('Context-churn library requires a context-churn turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Context-churn library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Context-churn library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.observedCount) || report.observedCount < 0
    || report.observedCount > report.sampleCount) {
    throw new RangeError('Context-churn library report observedCount must fit inside sampleCount');
  }
  if (!Number.isInteger(report.highRateCount) || report.highRateCount < 0
    || report.highRateCount > report.observedCount) {
    throw new RangeError('Context-churn library report highRateCount must fit inside observedCount');
  }
  if (!bounded(report.highRateFraction, 0, 1)) {
    throw new RangeError('Context-churn library report highRateFraction must be between 0 and 1');
  }
  if (report.peakSwitchRate !== null && !bounded(report.peakSwitchRate, 0, 16)) {
    throw new RangeError('Context-churn library report peak must be null or between 0 and 16');
  }
  if (report.meanSwitchRate !== null && !bounded(report.meanSwitchRate, 0, 16)) {
    throw new RangeError('Context-churn library report mean must be null or between 0 and 16');
  }
  if (!bounded(report.maximumDelta, 0, 16)) {
    throw new RangeError('Context-churn library report maximumDelta must be between 0 and 16');
  }
  if (!Number.isInteger(report.reversalCount) || report.reversalCount < 0
    || report.reversalCount > report.sampleCount) {
    throw new RangeError('Context-churn library report reversalCount must fit inside sampleCount');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Context-churn library reports must be an array');
  if (reports.length > 64) throw new RangeError('Context-churn library accepts at most 64 reports');
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
  if (reports.some((report) => report.state === 'volatile-churn')) return 'volatile-churn';
  if (reports.some((report) => report.state === 'high-churn')) return 'high-churn';
  if (reports.some((report) => report.state === 'reversal-watch')) return 'reversal-watch';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  return reports.some((report) => report.state === 'stable-churn')
    ? 'stable-churn'
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
  if (state === 'volatile-churn') return Object.freeze(['observe-context-switch-volatility']);
  if (state === 'high-churn') return Object.freeze(['observe-scheduler-churn-duration']);
  if (state === 'reversal-watch') return Object.freeze(['observe-next-churn-sample']);
  if (state === 'no-observation') return Object.freeze(['request-context-switch-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-context-switch-samples']);
  return Object.freeze(['no-change']);
}

export function mergeCpuSchedulerContextChurnReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_SCHEDULER_CHURN_LIBRARY_ID,
    libraryVersion: CPU_SCHEDULER_CHURN_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    highRateFraction: weightedAverage(validated, (report) => report.highRateFraction),
    peakSwitchRate: maximum(validated, (report) => report.peakSwitchRate),
    meanSwitchRate: weightedAverage(validated, (report) => report.meanSwitchRate),
    maximumDelta: maximum(validated, (report) => report.maximumDelta),
    reversalCount: maximum(validated, (report) => report.reversalCount),
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    highRateCount: validated.reduce((sum, report) => sum + report.highRateCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'volatile-churn') return 'volatility-observation';
  if (state === 'high-churn') return 'churn-observation';
  if (state === 'reversal-watch') return 'reversal-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'volatile-churn') return 250;
  if (state === 'high-churn') return 500;
  if (state === 'reversal-watch') return 750;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function buildCpuSchedulerContextChurnPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_SCHEDULER_CHURN_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Context-churn library clock must return a number');
  return timestamp;
}

export function buildCpuSchedulerContextChurnEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Context-churn library trigger is required');
  }
  return Object.freeze({
    library: CPU_SCHEDULER_CHURN_LIBRARY_ID,
    libraryVersion: CPU_SCHEDULER_CHURN_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuSchedulerContextChurnLibrary() {
  return Object.freeze({
    id: CPU_SCHEDULER_CHURN_LIBRARY_ID,
    version: CPU_SCHEDULER_CHURN_LIBRARY_VERSION,
    merge: mergeCpuSchedulerContextChurnReports,
    plan: buildCpuSchedulerContextChurnPlan,
    envelope: buildCpuSchedulerContextChurnEnvelope
  });
}
