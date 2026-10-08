/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated policy-shift turbo library. It validates and aggregates frequency
 * policy reports without importing the turbo, engine, or operating-system API.
 */

export const CPU_FREQUENCY_POLICY_LIBRARY_ID = 'cpu-frequency.policy-shift.library';
export const CPU_FREQUENCY_POLICY_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-policy',
  'policy-watch',
  'frequent-shift',
  'unsupported-policy',
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
  if (!isRecord(report)) throw new TypeError('Policy-shift library report must be an object');
  if (report.turbo !== 'cpu-frequency.policy-shift') {
    throw new Error('Policy-shift library requires a policy-shift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Policy-shift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Policy-shift library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['unsupportedCount', 'unsupported count'],
    ['comparisonCount', 'comparison count'],
    ['changeCount', 'change count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
      throw new RangeError(`Policy-shift library report ${label} must fit inside sampleCount`);
    }
  }
  if (!bounded(report.changeRate, 0, 1)) {
    throw new RangeError('Policy-shift library report changeRate must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Policy-shift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Policy-shift library accepts at most 64 reports');
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

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'unsupported-policy')) return 'unsupported-policy';
  if (reports.some((report) => report.state === 'frequent-shift')) return 'frequent-shift';
  if (reports.some((report) => report.state === 'policy-watch')) return 'policy-watch';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  return reports.some((report) => report.state === 'stable-policy')
    ? 'stable-policy'
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
  if (state === 'unsupported-policy') return Object.freeze(['review-undocumented-frequency-control']);
  if (state === 'frequent-shift') return Object.freeze(['observe-frequency-policy-duration']);
  if (state === 'policy-watch') return Object.freeze(['observe-next-frequency-sample']);
  if (state === 'no-observation') return Object.freeze(['request-frequency-policy-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-frequency-samples']);
  return Object.freeze(['no-change']);
}

export function mergeCpuFrequencyPolicyReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: CPU_FREQUENCY_POLICY_LIBRARY_ID,
    libraryVersion: CPU_FREQUENCY_POLICY_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    unsupportedCount: validated.reduce((sum, report) => sum + report.unsupportedCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0),
    changeRate: weightedAverage(validated, (report) => report.changeRate),
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
  if (state === 'unsupported-policy') return 'policy-review';
  if (state === 'frequent-shift') return 'change-observation';
  if (state === 'policy-watch') return 'trend-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'relaxed-observation';
}

function intervalFor(state, environment) {
  if (state === 'unsupported-policy') return 500;
  if (state === 'frequent-shift') return 750;
  if (state === 'policy-watch') return 1000;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function buildCpuFrequencyPolicyPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: CPU_FREQUENCY_POLICY_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Policy-shift library clock must return a number');
  return timestamp;
}

export function buildCpuFrequencyPolicyEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Policy-shift library trigger is required');
  }
  return Object.freeze({
    library: CPU_FREQUENCY_POLICY_LIBRARY_ID,
    libraryVersion: CPU_FREQUENCY_POLICY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createCpuFrequencyPolicyLibrary() {
  return Object.freeze({
    id: CPU_FREQUENCY_POLICY_LIBRARY_ID,
    version: CPU_FREQUENCY_POLICY_LIBRARY_VERSION,
    merge: mergeCpuFrequencyPolicyReports,
    plan: buildCpuFrequencyPolicyPlan,
    envelope: buildCpuFrequencyPolicyEnvelope
  });
}
