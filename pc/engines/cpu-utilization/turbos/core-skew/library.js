/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated core-skew turbo library. It validates and aggregates per-core
 * reports without importing the turbo or changing affinity policy.
 */

export const CPU_UTILIZATION_CORE_SKEW_LIBRARY_ID = 'cpu-utilization.core-skew.library';
export const CPU_UTILIZATION_CORE_SKEW_LIBRARY_VERSION = 1;

const STATES = Object.freeze(['balanced', 'high-skew', 'migration-watch', 'no-observation', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, lower, upper) {
  return Number.isFinite(value) && value >= lower && value <= upper;
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Core-skew library report must be an object');
  if (report.turbo !== 'cpu-utilization.core-skew') {
    throw new Error('Core-skew library requires a core-skew turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Core-skew library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Core-skew library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.observedCount) || report.observedCount < 0
    || report.observedCount > report.sampleCount) {
    throw new RangeError('Core-skew library report observedCount must fit inside sampleCount');
  }
  if (report.averageSkewPercent !== null && !bounded(report.averageSkewPercent, 0, 100)) {
    throw new RangeError('Core-skew library report average skew must be null or between 0 and 100');
  }
  if (report.maximumSkewPercent !== null && !bounded(report.maximumSkewPercent, 0, 100)) {
    throw new RangeError('Core-skew library report maximum skew must be null or between 0 and 100');
  }
  if (!Number.isInteger(report.dominantCoreChanges) || report.dominantCoreChanges < 0) {
    throw new RangeError('Core-skew library report dominant changes must be non-negative');
  }
  if (!Number.isInteger(report.overloadedCoreSamples) || report.overloadedCoreSamples < 0) {
    throw new RangeError('Core-skew library report overloaded samples must be non-negative');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Core-skew library reports must be an array');
  if (reports.length > 64) throw new RangeError('Core-skew library accepts at most 64 reports');
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
  if (reports.some((report) => report.state === 'high-skew')) return 'high-skew';
  if (reports.some((report) => report.state === 'migration-watch')) return 'migration-watch';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  return reports.some((report) => report.state === 'balanced') ? 'balanced' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'high-skew') return Object.freeze(['review-core-contention']);
  if (state === 'migration-watch') return Object.freeze(['observe-dominant-core-migration']);
  if (state === 'no-observation') return Object.freeze(['request-core-utilization-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-core-samples']);
  return Object.freeze(['no-change']);
}

export function mergeCpuUtilizationCoreSkewReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_UTILIZATION_CORE_SKEW_LIBRARY_ID,
    libraryVersion: CPU_UTILIZATION_CORE_SKEW_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    averageSkewPercent: weightedAverage(validated, (report) => report.averageSkewPercent),
    maximumSkewPercent: maximum(validated, (report) => report.maximumSkewPercent),
    dominantCoreChanges: validated.reduce((sum, report) => sum + report.dominantCoreChanges, 0),
    overloadedCoreSamples: validated.reduce((sum, report) => sum + report.overloadedCoreSamples, 0),
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
  if (state === 'high-skew') return 'contention-observation';
  if (state === 'migration-watch') return 'migration-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'high-skew') return 500;
  if (state === 'migration-watch') return 750;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function buildCpuUtilizationCoreSkewPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_UTILIZATION_CORE_SKEW_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Core-skew library clock must return a number');
  return timestamp;
}

export function buildCpuUtilizationCoreSkewEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Core-skew library trigger is required');
  }
  return Object.freeze({
    library: CPU_UTILIZATION_CORE_SKEW_LIBRARY_ID,
    libraryVersion: CPU_UTILIZATION_CORE_SKEW_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuUtilizationCoreSkewLibrary() {
  return Object.freeze({
    id: CPU_UTILIZATION_CORE_SKEW_LIBRARY_ID,
    version: CPU_UTILIZATION_CORE_SKEW_LIBRARY_VERSION,
    merge: mergeCpuUtilizationCoreSkewReports,
    plan: buildCpuUtilizationCoreSkewPlan,
    envelope: buildCpuUtilizationCoreSkewEnvelope
  });
}
