/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated mask-drift turbo library. It validates and aggregates list-drift
 * reports without importing the turbo, engine, or operating-system API.
 */

export const CPU_AFFINITY_DRIFT_LIBRARY_ID = 'cpu-affinity.mask-drift.library';
export const CPU_AFFINITY_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-layout',
  'drift-watch',
  'high-drift',
  'frequent-drift',
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
  if (!isRecord(report)) throw new TypeError('Mask-drift library report must be an object');
  if (report.turbo !== 'cpu-affinity.mask-drift') {
    throw new Error('Mask-drift library requires a mask-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Mask-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Mask-drift library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['comparisonCount', 'comparison count'],
    ['changeCount', 'change count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
      throw new RangeError(`Mask-drift library report ${label} must fit inside sampleCount`);
    }
  }
  for (const [field, label] of [
    ['peakDrift', 'peak drift'],
    ['meanDrift', 'mean drift']
  ]) {
    if (report[field] !== null && !bounded(report[field], 0, 1)) {
      throw new RangeError(`Mask-drift library report ${label} must be null or between 0 and 1`);
    }
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Mask-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Mask-drift library accepts at most 64 reports');
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
  if (reports.some((report) => report.state === 'frequent-drift')) return 'frequent-drift';
  if (reports.some((report) => report.state === 'high-drift')) return 'high-drift';
  if (reports.some((report) => report.state === 'drift-watch')) return 'drift-watch';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  return reports.some((report) => report.state === 'stable-layout')
    ? 'stable-layout'
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
  if (state === 'frequent-drift') return Object.freeze(['observe-affinity-change-duration']);
  if (state === 'high-drift') return Object.freeze(['review-affinity-list-change']);
  if (state === 'drift-watch') return Object.freeze(['observe-next-affinity-sample']);
  if (state === 'no-observation') return Object.freeze(['request-affinity-drift-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-affinity-samples']);
  return Object.freeze(['no-change']);
}

export function mergeCpuAffinityDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_AFFINITY_DRIFT_LIBRARY_ID,
    libraryVersion: CPU_AFFINITY_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0),
    peakDrift: maximum(validated, (report) => report.peakDrift),
    meanDrift: weightedAverage(validated, (report) => report.meanDrift),
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'frequent-drift') return 'change-observation';
  if (state === 'high-drift') return 'drift-review';
  if (state === 'drift-watch') return 'trend-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'frequent-drift') return 500;
  if (state === 'high-drift') return 750;
  if (state === 'drift-watch') return 1000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function buildCpuAffinityDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_AFFINITY_DRIFT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Mask-drift library clock must return a number');
  return timestamp;
}

export function buildCpuAffinityDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Mask-drift library trigger is required');
  }
  return Object.freeze({
    library: CPU_AFFINITY_DRIFT_LIBRARY_ID,
    libraryVersion: CPU_AFFINITY_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuAffinityDriftLibrary() {
  return Object.freeze({
    id: CPU_AFFINITY_DRIFT_LIBRARY_ID,
    version: CPU_AFFINITY_DRIFT_LIBRARY_VERSION,
    merge: mergeCpuAffinityDriftReports,
    plan: buildCpuAffinityDriftPlan,
    envelope: buildCpuAffinityDriftEnvelope
  });
}
