/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated pressure-policy-drift library. It validates, aggregates, and
 * plans drift reports without importing the turbo or operating-system API.
 */

export const MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_ID = 'memory-policy.pressure-policy-drift.library';
export const MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-policy',
  'policy-escalation',
  'policy-recovery',
  'policy-churn',
  'invalid-policy-evidence',
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

function requireCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Pressure-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Pressure-drift library report must be an object');
  if (report.turbo !== 'memory-policy.pressure-policy-drift') {
    throw new Error('Pressure-drift library requires a pressure-policy-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Pressure-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Pressure-drift library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['policyChanges', 'policy changes'],
    ['escalationCount', 'escalation count'],
    ['recoveryCount', 'recovery count'],
    ['comparisonCount', 'comparison count']
  ]) requireCount(report, field, label);
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Pressure-drift library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Pressure-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Pressure-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-policy-evidence')) return 'invalid-policy-evidence';
  if (reports.some((report) => report.state === 'policy-churn')) return 'policy-churn';
  if (reports.some((report) => report.state === 'policy-escalation')) return 'policy-escalation';
  if (reports.some((report) => report.state === 'policy-recovery')) return 'policy-recovery';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'stable-policy')
    ? 'stable-policy' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'invalid-policy-evidence') return Object.freeze(['review-memory-policy-sensor-range']);
  if (state === 'policy-churn') return Object.freeze(['hold-policy-automation', 'review-policy-transitions']);
  if (state === 'policy-escalation') return Object.freeze(['review-memory-pressure-escalation']);
  if (state === 'policy-recovery') return Object.freeze(['observe-memory-policy-recovery']);
  if (state === 'no-observation') return Object.freeze(['request-memory-policy-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-policy-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-policy-evidence') return 'sensor-review';
  if (state === 'policy-churn') return 'transition-review';
  if (state === 'policy-escalation') return 'escalation-observation';
  if (state === 'policy-recovery') return 'recovery-observation';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-policy-evidence') return 500;
  if (state === 'policy-churn') return 750;
  if (state === 'policy-escalation') return 1000;
  if (state === 'policy-recovery') return 1500;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeMemoryPolicyPressureDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_ID,
    libraryVersion: MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    policyChanges: validated.reduce((sum, report) => sum + report.policyChanges, 0),
    escalationCount: validated.reduce((sum, report) => sum + report.escalationCount, 0),
    recoveryCount: validated.reduce((sum, report) => sum + report.recoveryCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildMemoryPolicyPressureDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0
      ? 0 : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Pressure-drift library clock must return a number');
  return timestamp;
}

export function buildMemoryPolicyPressureDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Pressure-drift library trigger is required');
  }
  return Object.freeze({
    library: MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_ID,
    libraryVersion: MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createMemoryPolicyPressureDriftLibrary() {
  return Object.freeze({
    id: MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_ID,
    version: MEMORY_POLICY_PRESSURE_DRIFT_LIBRARY_VERSION,
    merge: mergeMemoryPolicyPressureDriftReports,
    plan: buildMemoryPolicyPressureDriftPlan,
    envelope: buildMemoryPolicyPressureDriftEnvelope
  });
}
