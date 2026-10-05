/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated trend-slope turbo library. It validates and aggregates slope
 * reports without importing the turbo or changing CPU policy.
 */

export const CPU_UTILIZATION_TREND_LIBRARY_ID = 'cpu-utilization.trend-slope.library';
export const CPU_UTILIZATION_TREND_LIBRARY_VERSION = 1;

const STATES = Object.freeze(['rising-trend', 'falling-trend', 'volatile-window', 'flat-window', 'no-observation', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, lower, upper) {
  return Number.isFinite(value) && value >= lower && value <= upper;
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Trend-slope library report must be an object');
  if (report.turbo !== 'cpu-utilization.trend-slope') {
    throw new Error('Trend-slope library requires a trend-slope turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Trend-slope library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Trend-slope library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.observedCount) || report.observedCount < 0
    || report.observedCount > report.sampleCount) {
    throw new RangeError('Trend-slope library report observedCount must fit inside sampleCount');
  }
  if (report.meanUtilizationPercent !== null && !bounded(report.meanUtilizationPercent, 0, 100)) {
    throw new RangeError('Trend-slope library report mean must be null or between 0 and 100');
  }
  if (report.slopePercentPerSample !== null && !bounded(report.slopePercentPerSample, -100, 100)) {
    throw new RangeError('Trend-slope library report slope must be null or between -100 and 100');
  }
  if (report.rangePercent !== null && !bounded(report.rangePercent, 0, 100)) {
    throw new RangeError('Trend-slope library report range must be null or between 0 and 100');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Trend-slope library reports must be an array');
  if (reports.length > 64) throw new RangeError('Trend-slope library accepts at most 64 reports');
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
  if (reports.some((report) => report.state === 'rising-trend')) return 'rising-trend';
  if (reports.some((report) => report.state === 'falling-trend')) return 'falling-trend';
  if (reports.some((report) => report.state === 'volatile-window')) return 'volatile-window';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  return reports.some((report) => report.state === 'flat-window') ? 'flat-window' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'rising-trend') return Object.freeze(['observe-rising-cpu-demand']);
  if (state === 'falling-trend') return Object.freeze(['observe-falling-cpu-demand']);
  if (state === 'volatile-window') return Object.freeze(['observe-volatility-before-policy-review']);
  if (state === 'no-observation') return Object.freeze(['request-cpu-utilization-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cpu-samples']);
  return Object.freeze(['no-change']);
}

export function mergeCpuUtilizationTrendReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_UTILIZATION_TREND_LIBRARY_ID,
    libraryVersion: CPU_UTILIZATION_TREND_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    meanUtilizationPercent: weightedAverage(validated, (report) => report.meanUtilizationPercent),
    slopePercentPerSample: weightedAverage(validated, (report) => report.slopePercentPerSample),
    rangePercent: maximum(validated, (report) => report.rangePercent),
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
  if (state === 'rising-trend') return 'rising-observation';
  if (state === 'falling-trend') return 'falling-observation';
  if (state === 'volatile-window') return 'volatility-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'rising-trend') return 500;
  if (state === 'falling-trend') return 750;
  if (state === 'volatile-window') return 1000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function buildCpuUtilizationTrendPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_UTILIZATION_TREND_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Trend-slope library clock must return a number');
  return timestamp;
}

export function buildCpuUtilizationTrendEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Trend-slope library trigger is required');
  }
  return Object.freeze({
    library: CPU_UTILIZATION_TREND_LIBRARY_ID,
    libraryVersion: CPU_UTILIZATION_TREND_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuUtilizationTrendLibrary() {
  return Object.freeze({
    id: CPU_UTILIZATION_TREND_LIBRARY_ID,
    version: CPU_UTILIZATION_TREND_LIBRARY_VERSION,
    merge: mergeCpuUtilizationTrendReports,
    plan: buildCpuUtilizationTrendPlan,
    envelope: buildCpuUtilizationTrendEnvelope
  });
}
