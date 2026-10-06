/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated saturation-guard turbo library. It validates and aggregates
 * saturation reports without importing the turbo or changing CPU policy.
 */

export const CPU_UTILIZATION_SATURATION_LIBRARY_ID = 'cpu-utilization.saturation-guard.library';
export const CPU_UTILIZATION_SATURATION_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'clear',
  'intermittent-saturation',
  'sustained-saturation',
  'recovery-observed',
  'no-observation',
  'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedInteger(value, lower, upper = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(value) && value >= lower && value <= upper;
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Saturation-guard library report must be an object');
  if (report.turbo !== 'cpu-utilization.saturation-guard') {
    throw new Error('Saturation-guard library requires a saturation-guard turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Saturation-guard library report has an invalid state');
  if (!boundedInteger(report.sampleCount, 0)) {
    throw new RangeError('Saturation-guard library report sampleCount must be non-negative');
  }
  if (!boundedInteger(report.observedCount, 0, report.sampleCount)) {
    throw new RangeError('Saturation-guard library report observedCount must fit inside sampleCount');
  }
  if (!boundedInteger(report.saturationCount, 0, report.observedCount)) {
    throw new RangeError('Saturation-guard library report saturationCount must fit inside observedCount');
  }
  if (!boundedInteger(report.longestSaturationRun, 0, report.sampleCount)) {
    throw new RangeError('Saturation-guard library report longest run must fit inside sampleCount');
  }
  if (!boundedInteger(report.trailingSaturationRun, 0, report.sampleCount)) {
    throw new RangeError('Saturation-guard library report trailing run must fit inside sampleCount');
  }
  if (!boundedInteger(report.recoveryTransitions, 0, report.sampleCount)) {
    throw new RangeError('Saturation-guard library report recovery transitions must be non-negative');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Saturation-guard library reports must be an array');
  if (reports.length > 64) throw new RangeError('Saturation-guard library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function weightedAverage(reports, selector) {
  if (reports.length === 0) return null;
  const totalWeight = reports.reduce((sum, report) => sum + Math.max(1, report.sampleCount), 0);
  const total = reports.reduce((sum, report) => (
    sum + selector(report) * Math.max(1, report.sampleCount)
  ), 0);
  return Math.round((total / totalWeight) * 10000) / 10000;
}

function maximum(reports, selector) {
  return reports.length === 0 ? null : Math.max(...reports.map(selector));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'sustained-saturation')) return 'sustained-saturation';
  if (reports.some((report) => report.state === 'recovery-observed')) return 'recovery-observed';
  if (reports.some((report) => report.state === 'intermittent-saturation')) {
    return 'intermittent-saturation';
  }
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  return reports.some((report) => report.state === 'clear') ? 'clear' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const sampleCount = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (sampleCount === 0) return 0;
  const observedCount = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observedCount / sampleCount) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'sustained-saturation') return Object.freeze(['protect-foreground']);
  if (state === 'recovery-observed') return Object.freeze(['observe-recovery-window']);
  if (state === 'intermittent-saturation') return Object.freeze(['observe-next-cpu-sample']);
  if (state === 'no-observation') return Object.freeze(['request-cpu-utilization-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-cpu-samples']);
  return Object.freeze(['no-change']);
}

export function mergeCpuUtilizationSaturationReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_UTILIZATION_SATURATION_LIBRARY_ID,
    libraryVersion: CPU_UTILIZATION_SATURATION_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    saturationCount: validated.reduce((sum, report) => sum + report.saturationCount, 0),
    longestSaturationRun: maximum(validated, (report) => report.longestSaturationRun),
    trailingSaturationRun: maximum(validated, (report) => report.trailingSaturationRun),
    recoveryTransitions: validated.reduce((sum, report) => sum + report.recoveryTransitions, 0),
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    saturationRate: weightedAverage(validated, (report) => report.sampleCount === 0
      ? 0 : report.saturationCount / report.sampleCount),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'sustained-saturation') return 'protective-observation';
  if (state === 'recovery-observed') return 'recovery-observation';
  if (state === 'intermittent-saturation') return 'contention-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'sustained-saturation') return 250;
  if (state === 'recovery-observed') return 500;
  if (state === 'intermittent-saturation') return 750;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function buildCpuUtilizationSaturationPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_UTILIZATION_SATURATION_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Saturation-guard library clock must return a number');
  return timestamp;
}

export function buildCpuUtilizationSaturationEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Saturation-guard library trigger is required');
  }
  return Object.freeze({
    library: CPU_UTILIZATION_SATURATION_LIBRARY_ID,
    libraryVersion: CPU_UTILIZATION_SATURATION_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuUtilizationSaturationLibrary() {
  return Object.freeze({
    id: CPU_UTILIZATION_SATURATION_LIBRARY_ID,
    version: CPU_UTILIZATION_SATURATION_LIBRARY_VERSION,
    merge: mergeCpuUtilizationSaturationReports,
    plan: buildCpuUtilizationSaturationPlan,
    envelope: buildCpuUtilizationSaturationEnvelope
  });
}
