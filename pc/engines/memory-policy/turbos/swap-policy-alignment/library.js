/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated swap-policy-alignment library. It validates, aggregates, and
 * plans swap alignment reports without importing the turbo or applying policy.
 */

export const MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_ID = 'memory-policy.swap-policy-alignment.library';
export const MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'aligned-swap-policy',
  'critical-swap-policy-gap',
  'swap-policy-gap',
  'policy-observation-required',
  'swap-observation-required',
  'no-observation',
  'invalid-swap-evidence',
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
    throw new RangeError(`Swap-alignment library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Swap-alignment library report must be an object');
  if (report.turbo !== 'memory-policy.swap-policy-alignment') {
    throw new Error('Swap-alignment library requires a swap-policy-alignment turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Swap-alignment library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Swap-alignment library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['swapObservedCount', 'swap observed count'],
    ['policyObservedCount', 'policy observed count'],
    ['mismatchCount', 'mismatch count'],
    ['criticalMismatchCount', 'critical mismatch count']
  ]) requireCount(report, field, label);
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Swap-alignment library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Swap-alignment library reports must be an array');
  if (reports.length > 64) throw new RangeError('Swap-alignment library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-swap-evidence')) return 'invalid-swap-evidence';
  if (reports.some((report) => report.state === 'critical-swap-policy-gap')) return 'critical-swap-policy-gap';
  if (reports.some((report) => report.state === 'swap-policy-gap')) return 'swap-policy-gap';
  if (reports.some((report) => report.state === 'swap-observation-required')) return 'swap-observation-required';
  if (reports.some((report) => report.state === 'policy-observation-required')) return 'policy-observation-required';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'aligned-swap-policy')
    ? 'aligned-swap-policy' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'invalid-swap-evidence') return Object.freeze(['review-swap-sensor-range']);
  if (state === 'critical-swap-policy-gap') {
    return Object.freeze(['hold-current-under-critical-swap', 'review-policy-consent']);
  }
  if (state === 'swap-policy-gap') return Object.freeze(['review-swap-aware-memory-policy']);
  if (state === 'swap-observation-required') return Object.freeze(['collect-complete-swap-window']);
  if (state === 'policy-observation-required') return Object.freeze(['request-memory-policy-observation']);
  if (state === 'no-observation') return Object.freeze(['request-swap-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-swap-policy-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-swap-evidence') return 'sensor-review';
  if (state === 'critical-swap-policy-gap') return 'critical-swap-review';
  if (state === 'swap-policy-gap') return 'swap-policy-review';
  if (state === 'swap-observation-required') return 'swap-observation-bootstrap';
  if (state === 'policy-observation-required') return 'policy-observation-bootstrap';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'swap-policy-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-swap-evidence') return 500;
  if (state === 'critical-swap-policy-gap') return 750;
  if (state === 'swap-policy-gap') return 1000;
  if (state === 'swap-observation-required') return 1800;
  if (state === 'policy-observation-required') return 2200;
  if (state === 'no-observation') return 2500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeMemoryPolicySwapPolicyAlignmentReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_ID,
    libraryVersion: MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    swapObservedCount: validated.reduce((sum, report) => sum + report.swapObservedCount, 0),
    policyObservedCount: validated.reduce((sum, report) => sum + report.policyObservedCount, 0),
    mismatchCount: validated.reduce((sum, report) => sum + report.mismatchCount, 0),
    criticalMismatchCount: validated.reduce((sum, report) => sum + report.criticalMismatchCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildMemoryPolicySwapPolicyAlignmentPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Swap-alignment library clock must return a number');
  return timestamp;
}

export function buildMemoryPolicySwapPolicyAlignmentEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Swap-alignment library trigger is required');
  }
  return Object.freeze({
    library: MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_ID,
    libraryVersion: MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createMemoryPolicySwapPolicyAlignmentLibrary() {
  return Object.freeze({
    id: MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_ID,
    version: MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_LIBRARY_VERSION,
    merge: mergeMemoryPolicySwapPolicyAlignmentReports,
    plan: buildMemoryPolicySwapPolicyAlignmentPlan,
    envelope: buildMemoryPolicySwapPolicyAlignmentEnvelope
  });
}
