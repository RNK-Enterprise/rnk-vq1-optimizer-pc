/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated headless-posture library. It validates, aggregates, and plans
 * posture reports without importing the turbo or changing environment policy.
 */

export const MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_ID = 'memory-policy.headless-posture.library';
export const MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'aligned-posture',
  'headless-protection-gap',
  'interactive-policy-gap',
  'profile-required',
  'no-observation',
  'invalid-posture-evidence',
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
    throw new RangeError(`Headless-posture library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Headless-posture library report must be an object');
  if (report.turbo !== 'memory-policy.headless-posture') {
    throw new Error('Headless-posture library requires a headless-posture turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Headless-posture library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Headless-posture library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['headlessGapCount', 'headless gap count'],
    ['interactiveGapCount', 'interactive gap count'],
    ['unknownEnvironmentCount', 'unknown environment count']
  ]) requireCount(report, field, label);
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Headless-posture library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Headless-posture library reports must be an array');
  if (reports.length > 64) throw new RangeError('Headless-posture library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-posture-evidence')) return 'invalid-posture-evidence';
  if (reports.some((report) => report.state === 'headless-protection-gap')) return 'headless-protection-gap';
  if (reports.some((report) => report.state === 'interactive-policy-gap')) return 'interactive-policy-gap';
  if (reports.some((report) => report.state === 'profile-required')) return 'profile-required';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'aligned-posture')
    ? 'aligned-posture' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'invalid-posture-evidence') return Object.freeze(['review-memory-policy-sensor-range']);
  if (state === 'headless-protection-gap') {
    return Object.freeze(['hold-headless-policy-automation', 'review-service-protection']);
  }
  if (state === 'interactive-policy-gap') return Object.freeze(['review-interactive-memory-policy']);
  if (state === 'profile-required') return Object.freeze(['request-environment-profile']);
  if (state === 'no-observation') return Object.freeze(['request-memory-policy-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-posture-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-posture-evidence') return 'sensor-review';
  if (state === 'headless-protection-gap') return 'headless-protection-review';
  if (state === 'interactive-policy-gap') return 'interactive-policy-review';
  if (state === 'profile-required') return 'environment-profile';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'posture-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-posture-evidence') return 500;
  if (state === 'headless-protection-gap') return 750;
  if (state === 'interactive-policy-gap') return 1000;
  if (state === 'profile-required') return 2000;
  if (state === 'no-observation') return 2500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeMemoryPolicyHeadlessPostureReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_ID,
    libraryVersion: MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    headlessGapCount: validated.reduce((sum, report) => sum + report.headlessGapCount, 0),
    interactiveGapCount: validated.reduce((sum, report) => sum + report.interactiveGapCount, 0),
    unknownEnvironmentCount: validated.reduce((sum, report) => sum + report.unknownEnvironmentCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildMemoryPolicyHeadlessPosturePlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Headless-posture library clock must return a number');
  return timestamp;
}

export function buildMemoryPolicyHeadlessPostureEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Headless-posture library trigger is required');
  }
  return Object.freeze({
    library: MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_ID,
    libraryVersion: MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createMemoryPolicyHeadlessPostureLibrary() {
  return Object.freeze({
    id: MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_ID,
    version: MEMORY_POLICY_HEADLESS_POSTURE_LIBRARY_VERSION,
    merge: mergeMemoryPolicyHeadlessPostureReports,
    plan: buildMemoryPolicyHeadlessPosturePlan,
    envelope: buildMemoryPolicyHeadlessPostureEnvelope
  });
}
