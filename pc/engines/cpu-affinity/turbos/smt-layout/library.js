/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated SMT-layout turbo library. It validates and aggregates ratio
 * reports without importing the turbo, engine, or operating-system API.
 */

export const CPU_AFFINITY_SMT_LIBRARY_ID = 'cpu-affinity.smt-layout.library';
export const CPU_AFFINITY_SMT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-smt',
  'ratio-shift',
  'heavy-smt',
  'inconsistent-layout',
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
  if (!isRecord(report)) throw new TypeError('SMT-layout library report must be an object');
  if (report.turbo !== 'cpu-affinity.smt-layout') {
    throw new Error('SMT-layout library requires an smt-layout turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('SMT-layout library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('SMT-layout library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['inconsistentCount', 'inconsistent count'],
    ['heavySampleCount', 'heavy sample count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
      throw new RangeError(`SMT-layout library report ${label} must fit inside sampleCount`);
    }
  }
  for (const [field, label] of [
    ['peakRatio', 'peak ratio'],
    ['meanRatio', 'mean ratio'],
    ['ratioRange', 'ratio range']
  ]) {
    if (report[field] !== null && !bounded(report[field], 0, 8)) {
      throw new RangeError(`SMT-layout library report ${label} must be null or between 0 and 8`);
    }
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('SMT-layout library reports must be an array');
  if (reports.length > 64) throw new RangeError('SMT-layout library accepts at most 64 reports');
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
  if (reports.some((report) => report.state === 'inconsistent-layout')) return 'inconsistent-layout';
  if (reports.some((report) => report.state === 'heavy-smt')) return 'heavy-smt';
  if (reports.some((report) => report.state === 'ratio-shift')) return 'ratio-shift';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  return reports.some((report) => report.state === 'stable-smt')
    ? 'stable-smt'
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
  if (state === 'inconsistent-layout') return Object.freeze(['reject-unverified-smt-layout']);
  if (state === 'heavy-smt') return Object.freeze(['preserve-os-smt-layout']);
  if (state === 'ratio-shift') return Object.freeze(['observe-next-smt-sample']);
  if (state === 'no-observation') return Object.freeze(['request-smt-topology-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-smt-samples']);
  return Object.freeze(['no-change']);
}

export function mergeCpuAffinitySmtReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_AFFINITY_SMT_LIBRARY_ID,
    libraryVersion: CPU_AFFINITY_SMT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    inconsistentCount: validated.reduce((sum, report) => sum + report.inconsistentCount, 0),
    heavySampleCount: validated.reduce((sum, report) => sum + report.heavySampleCount, 0),
    peakRatio: maximum(validated, (report) => report.peakRatio),
    meanRatio: weightedAverage(validated, (report) => report.meanRatio),
    ratioRange: maximum(validated, (report) => report.ratioRange),
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
  if (state === 'inconsistent-layout') return 'layout-review';
  if (state === 'heavy-smt') return 'smt-preservation';
  if (state === 'ratio-shift') return 'trend-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'inconsistent-layout' || state === 'heavy-smt') return 500;
  if (state === 'ratio-shift') return 1000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function buildCpuAffinitySmtPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_AFFINITY_SMT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('SMT-layout library clock must return a number');
  return timestamp;
}

export function buildCpuAffinitySmtEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('SMT-layout library trigger is required');
  }
  return Object.freeze({
    library: CPU_AFFINITY_SMT_LIBRARY_ID,
    libraryVersion: CPU_AFFINITY_SMT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuAffinitySmtLibrary() {
  return Object.freeze({
    id: CPU_AFFINITY_SMT_LIBRARY_ID,
    version: CPU_AFFINITY_SMT_LIBRARY_VERSION,
    merge: mergeCpuAffinitySmtReports,
    plan: buildCpuAffinitySmtPlan,
    envelope: buildCpuAffinitySmtEnvelope
  });
}
