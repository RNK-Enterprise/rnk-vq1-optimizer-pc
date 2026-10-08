/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated governor-transitions turbo library. It validates and aggregates
 * governor reports without importing the turbo, engine, or operating-system API.
 */

export const CPU_SCHEDULER_GOVERNOR_LIBRARY_ID = 'cpu-scheduler.governor-transitions.library';
export const CPU_SCHEDULER_GOVERNOR_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-governor',
  'transition-watch',
  'frequent-transition',
  'powersave-under-load',
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
  if (!isRecord(report)) throw new TypeError('Governor-transitions library report must be an object');
  if (report.turbo !== 'cpu-scheduler.governor-transitions') {
    throw new Error('Governor-transitions library requires a governor-transitions turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('Governor-transitions library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Governor-transitions library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.observedCount) || report.observedCount < 0
    || report.observedCount > report.sampleCount) {
    throw new RangeError('Governor-transitions library report observedCount must fit inside sampleCount');
  }
  if (!Number.isInteger(report.unknownGovernorCount) || report.unknownGovernorCount < 0
    || report.unknownGovernorCount > report.sampleCount) {
    throw new RangeError('Governor-transitions library report unknown count must fit inside sampleCount');
  }
  if (!Number.isInteger(report.transitionCount) || report.transitionCount < 0
    || report.transitionCount > report.sampleCount) {
    throw new RangeError('Governor-transitions library report transitionCount must fit inside sampleCount');
  }
  if (!bounded(report.transitionRate, 0, 1)) {
    throw new RangeError('Governor-transitions library report transitionRate must be between 0 and 1');
  }
  for (const [field, label] of [
    ['performanceCount', 'performance count'],
    ['powersaveCount', 'powersave count'],
    ['schedutilCount', 'schedutil count'],
    ['powersaveUnderLoad', 'powersave-under-load count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
      throw new RangeError(`Governor-transitions library report ${label} must fit inside sampleCount`);
    }
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Governor-transitions library reports must be an array');
  if (reports.length > 64) throw new RangeError('Governor-transitions library accepts at most 64 reports');
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
  if (reports.some((report) => report.state === 'powersave-under-load')) return 'powersave-under-load';
  if (reports.some((report) => report.state === 'frequent-transition')) return 'frequent-transition';
  if (reports.some((report) => report.state === 'transition-watch')) return 'transition-watch';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  return reports.some((report) => report.state === 'stable-governor')
    ? 'stable-governor'
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
  if (state === 'powersave-under-load') return Object.freeze(['review-documented-governor-control']);
  if (state === 'frequent-transition') return Object.freeze(['observe-governor-transition-duration']);
  if (state === 'transition-watch') return Object.freeze(['observe-next-governor-sample']);
  if (state === 'no-observation') return Object.freeze(['request-governor-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-governor-samples']);
  return Object.freeze(['no-change']);
}

export function mergeCpuSchedulerGovernorReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_SCHEDULER_GOVERNOR_LIBRARY_ID,
    libraryVersion: CPU_SCHEDULER_GOVERNOR_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    transitionRate: weightedAverage(validated, (report) => report.transitionRate),
    transitionCount: validated.reduce((sum, report) => sum + report.transitionCount, 0),
    unknownGovernorCount: validated.reduce((sum, report) => sum + report.unknownGovernorCount, 0),
    performanceCount: validated.reduce((sum, report) => sum + report.performanceCount, 0),
    powersaveCount: validated.reduce((sum, report) => sum + report.powersaveCount, 0),
    schedutilCount: validated.reduce((sum, report) => sum + report.schedutilCount, 0),
    powersaveUnderLoad: maximum(validated, (report) => report.powersaveUnderLoad),
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
  if (state === 'powersave-under-load') return 'governor-control-review';
  if (state === 'frequent-transition') return 'transition-observation';
  if (state === 'transition-watch') return 'trend-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'powersave-under-load') return 500;
  if (state === 'frequent-transition') return 750;
  if (state === 'transition-watch') return 1000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function buildCpuSchedulerGovernorPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_SCHEDULER_GOVERNOR_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Governor-transitions library clock must return a number');
  return timestamp;
}

export function buildCpuSchedulerGovernorEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Governor-transitions library trigger is required');
  }
  return Object.freeze({
    library: CPU_SCHEDULER_GOVERNOR_LIBRARY_ID,
    libraryVersion: CPU_SCHEDULER_GOVERNOR_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuSchedulerGovernorLibrary() {
  return Object.freeze({
    id: CPU_SCHEDULER_GOVERNOR_LIBRARY_ID,
    version: CPU_SCHEDULER_GOVERNOR_LIBRARY_VERSION,
    merge: mergeCpuSchedulerGovernorReports,
    plan: buildCpuSchedulerGovernorPlan,
    envelope: buildCpuSchedulerGovernorEnvelope
  });
}
