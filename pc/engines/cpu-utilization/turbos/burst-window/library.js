/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated burst-window turbo library. It validates and aggregates burst
 * reports without importing the turbo, engine, or any operating-system API.
 */

export const CPU_UTILIZATION_BURST_LIBRARY_ID = 'cpu-utilization.burst-window.library';
export const CPU_UTILIZATION_BURST_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-window',
  'rising-burst',
  'burst-detected',
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
  if (!isRecord(report)) throw new TypeError('Burst-window library report must be an object');
  if (report.turbo !== 'cpu-utilization.burst-window') {
    throw new Error('Burst-window library requires a burst-window turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Burst-window library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Burst-window library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.observedCount) || report.observedCount < 0
    || report.observedCount > report.sampleCount) {
    throw new RangeError('Burst-window library report observedCount must fit inside sampleCount');
  }
  if (!Number.isInteger(report.burstCount) || report.burstCount < 0
    || report.burstCount > report.observedCount) {
    throw new RangeError('Burst-window library report burstCount must fit inside observedCount');
  }
  if (!bounded(report.burstRate, 0, 1)) {
    throw new RangeError('Burst-window library report burstRate must be between 0 and 1');
  }
  if (report.peakUtilizationPercent !== null
    && !bounded(report.peakUtilizationPercent, 0, 100)) {
    throw new RangeError('Burst-window library report peak must be null or between 0 and 100');
  }
  if (!bounded(report.maximumRisePercent, 0, 100)) {
    throw new RangeError('Burst-window library report maximumRise must be between 0 and 100');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Burst-window library reports must be an array');
  if (reports.length > 64) throw new RangeError('Burst-window library accepts at most 64 reports');
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
  if (reports.some((report) => report.state === 'burst-detected')) return 'burst-detected';
  if (reports.some((report) => report.state === 'rising-burst')) return 'rising-burst';
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
  if (state === 'burst-detected') return Object.freeze(['observe-burst-duration']);
  if (state === 'rising-burst') return Object.freeze(['observe-next-cpu-sample']);
  if (state === 'no-observation') return Object.freeze(['request-cpu-utilization-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cpu-samples']);
  return Object.freeze(['no-change']);
}

export function mergeCpuUtilizationBurstReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_UTILIZATION_BURST_LIBRARY_ID,
    libraryVersion: CPU_UTILIZATION_BURST_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    burstRate: weightedAverage(validated, (report) => report.burstRate),
    peakUtilizationPercent: maximum(validated, (report) => report.peakUtilizationPercent),
    maximumRisePercent: maximum(validated, (report) => report.maximumRisePercent),
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
  if (state === 'burst-detected') return 'burst-observation';
  if (state === 'rising-burst') return 'trend-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'burst-detected') return 250;
  if (state === 'rising-burst') return 500;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function buildCpuUtilizationBurstPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_UTILIZATION_BURST_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.observedCount === 0 ? 0
      : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Burst-window library clock must return a number');
  return timestamp;
}

export function buildCpuUtilizationBurstEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Burst-window library trigger is required');
  }
  return Object.freeze({
    library: CPU_UTILIZATION_BURST_LIBRARY_ID,
    libraryVersion: CPU_UTILIZATION_BURST_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuUtilizationBurstLibrary() {
  return Object.freeze({
    id: CPU_UTILIZATION_BURST_LIBRARY_ID,
    version: CPU_UTILIZATION_BURST_LIBRARY_VERSION,
    merge: mergeCpuUtilizationBurstReports,
    plan: buildCpuUtilizationBurstPlan,
    envelope: buildCpuUtilizationBurstEnvelope
  });
}
