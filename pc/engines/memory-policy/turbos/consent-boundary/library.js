/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated consent-boundary library. It validates, aggregates, and plans
 * consent reports without importing the turbo or approving policy changes.
 */

export const MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_ID = 'memory-policy.consent-boundary.library';
export const MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'consent-aligned',
  'no-policy-request',
  'consent-required',
  'destructive-blocked',
  'invalid-consent-evidence',
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
    throw new RangeError(`Consent-boundary library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Consent-boundary library report must be an object');
  if (report.turbo !== 'memory-policy.consent-boundary') {
    throw new Error('Consent-boundary library requires a consent-boundary turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Consent-boundary library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Consent-boundary library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'],
    ['unknownCount', 'unknown count'],
    ['invalidCount', 'invalid count'],
    ['blockedCount', 'blocked count'],
    ['consentGapCount', 'consent gap count'],
    ['requestCount', 'request count']
  ]) requireCount(report, field, label);
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Consent-boundary library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Consent-boundary library reports must be an array');
  if (reports.length > 64) throw new RangeError('Consent-boundary library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'invalid-consent-evidence')) return 'invalid-consent-evidence';
  if (reports.some((report) => report.state === 'destructive-blocked')) return 'destructive-blocked';
  if (reports.some((report) => report.state === 'consent-required')) return 'consent-required';
  if (reports.every((report) => report.state === 'no-observation')) return 'no-observation';
  if (reports.every((report) => report.state === 'no-policy-request')) return 'no-policy-request';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'consent-aligned')
    ? 'consent-aligned' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'invalid-consent-evidence') return Object.freeze(['review-policy-consent-input']);
  if (state === 'destructive-blocked') return Object.freeze(['hold-destructive-actions', 'require-explicit-consent']);
  if (state === 'consent-required') return Object.freeze(['require-explicit-consent', 'hold-policy-automation']);
  if (state === 'no-policy-request') return Object.freeze(['no-policy-change-request']);
  if (state === 'no-observation') return Object.freeze(['request-policy-consent-observation']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-consent-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'invalid-consent-evidence') return 'consent-input-review';
  if (state === 'destructive-blocked') return 'destructive-hold';
  if (state === 'consent-required') return 'consent-review';
  if (state === 'no-policy-request') return 'request-review';
  if (state === 'no-observation') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'consent-observation';
}

function intervalFor(state, environment) {
  if (state === 'invalid-consent-evidence') return 500;
  if (state === 'destructive-blocked') return 750;
  if (state === 'consent-required') return 1000;
  if (state === 'no-policy-request') return 1500;
  if (state === 'no-observation') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeMemoryPolicyConsentBoundaryReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_ID,
    libraryVersion: MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    invalidCount: validated.reduce((sum, report) => sum + report.invalidCount, 0),
    blockedCount: validated.reduce((sum, report) => sum + report.blockedCount, 0),
    consentGapCount: validated.reduce((sum, report) => sum + report.consentGapCount, 0),
    requestCount: validated.reduce((sum, report) => sum + report.requestCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildMemoryPolicyConsentBoundaryPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Consent-boundary library clock must return a number');
  return timestamp;
}

export function buildMemoryPolicyConsentBoundaryEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Consent-boundary library trigger is required');
  }
  return Object.freeze({
    library: MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_ID,
    libraryVersion: MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createMemoryPolicyConsentBoundaryLibrary() {
  return Object.freeze({
    id: MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_ID,
    version: MEMORY_POLICY_CONSENT_BOUNDARY_LIBRARY_VERSION,
    merge: mergeMemoryPolicyConsentBoundaryReports,
    plan: buildMemoryPolicyConsentBoundaryPlan,
    envelope: buildMemoryPolicyConsentBoundaryEnvelope
  });
}
