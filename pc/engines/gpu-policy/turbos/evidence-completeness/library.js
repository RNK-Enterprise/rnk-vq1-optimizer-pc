/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated evidence-completeness library. It validates, aggregates, and
 * plans evidence reports without importing the turbo or changing GPU policy.
 */

export const GPU_EVIDENCE_COMPLETENESS_LIBRARY_ID = 'gpu-policy.evidence-completeness.library';
export const GPU_EVIDENCE_COMPLETENESS_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'completeness-drift',
  'incomplete-evidence-persistent',
  'incomplete-evidence-observed',
  'complete-evidence-stable',
  'inventory-boundary-drift',
  'no-gpu',
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
    throw new RangeError(`Evidence-completeness library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Evidence-completeness library report must be an object');
  if (report.turbo !== 'gpu-policy.evidence-completeness') {
    throw new Error('Evidence-completeness library requires an evidence-completeness turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('Evidence-completeness library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Evidence-completeness library report sampleCount must be non-negative');
  }
  for (const [field, label] of [
    ['usableCount', 'usable count'],
    ['completeCount', 'complete count'],
    ['incompleteCount', 'incomplete count'],
    ['noGpuCount', 'no-GPU count'],
    ['transitionCount', 'transition count']
  ]) requireCount(report, field, label);
  if (!Array.isArray(report.missingFields)) {
    throw new TypeError('Evidence-completeness library report missingFields must be an array');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Evidence-completeness library persistenceThreshold must be from 1 to 64');
  }
  if (!bounded(report.confidence, 0, 1)) {
    throw new RangeError('Evidence-completeness library report confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Evidence-completeness library reports must be an array');
  if (reports.length > 64) throw new RangeError('Evidence-completeness library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'inventory-boundary-drift')) {
    return 'inventory-boundary-drift';
  }
  if (reports.some((report) => report.state === 'completeness-drift')) return 'completeness-drift';
  if (reports.some((report) => report.state === 'incomplete-evidence-persistent')) {
    return 'incomplete-evidence-persistent';
  }
  if (reports.some((report) => report.state === 'incomplete-evidence-observed')) {
    return 'incomplete-evidence-observed';
  }
  if (reports.every((report) => report.state === 'no-gpu')) return 'no-gpu';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return reports.some((report) => report.state === 'complete-evidence-stable')
    ? 'complete-evidence-stable' : 'insufficient-data';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const usable = reports.reduce((sum, report) => sum + report.usableCount, 0);
  return Math.round((usable / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'completeness-drift') {
    return Object.freeze(['review-gpu-evidence-source-stability', 'hold-unapproved-gpu-policy']);
  }
  if (state === 'incomplete-evidence-persistent') {
    return Object.freeze(['request-complete-gpu-evidence', 'hold-unapproved-gpu-policy']);
  }
  if (state === 'incomplete-evidence-observed') {
    return Object.freeze(['observe-next-gpu-evidence-sample']);
  }
  if (state === 'inventory-boundary-drift') {
    return Object.freeze(['review-gpu-inventory-boundary', 'hold-unapproved-gpu-policy']);
  }
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-controls-disabled']);
  if (state === 'insufficient-data') return Object.freeze(['collect-more-gpu-evidence-samples']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'completeness-drift') return 'evidence-source-review';
  if (state === 'incomplete-evidence-persistent') return 'evidence-completion-review';
  if (state === 'incomplete-evidence-observed') return 'evidence-observation';
  if (state === 'inventory-boundary-drift') return 'inventory-boundary-review';
  if (state === 'no-gpu') return 'no-gpu-observation';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'complete-evidence-observation';
}

function intervalFor(state, environment) {
  if (state === 'completeness-drift') return 750;
  if (state === 'incomplete-evidence-persistent') return 1250;
  if (state === 'incomplete-evidence-observed') return 1500;
  if (state === 'inventory-boundary-drift') return 1000;
  if (state === 'no-gpu') return 10000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergeGpuEvidenceCompletenessReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  return Object.freeze({
    library: GPU_EVIDENCE_COMPLETENESS_LIBRARY_ID,
    libraryVersion: GPU_EVIDENCE_COMPLETENESS_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    usableCount: validated.reduce((sum, report) => sum + report.usableCount, 0),
    completeCount: validated.reduce((sum, report) => sum + report.completeCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noGpuCount: validated.reduce((sum, report) => sum + report.noGpuCount, 0),
    transitionCount: validated.reduce((sum, report) => sum + report.transitionCount, 0),
    missingFields: Object.freeze([...new Set(validated.flatMap((report) => report.missingFields))].sort()),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildGpuEvidenceCompletenessPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: GPU_EVIDENCE_COMPLETENESS_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0
      ? 0 : Math.round((validated.usableCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Evidence-completeness library clock must return a number');
  }
  return timestamp;
}

export function buildGpuEvidenceCompletenessEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Evidence-completeness library trigger is required');
  }
  return Object.freeze({
    library: GPU_EVIDENCE_COMPLETENESS_LIBRARY_ID,
    libraryVersion: GPU_EVIDENCE_COMPLETENESS_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createGpuEvidenceCompletenessLibrary() {
  return Object.freeze({
    id: GPU_EVIDENCE_COMPLETENESS_LIBRARY_ID,
    version: GPU_EVIDENCE_COMPLETENESS_LIBRARY_VERSION,
    merge: mergeGpuEvidenceCompletenessReports,
    plan: buildGpuEvidenceCompletenessPlan,
    envelope: buildGpuEvidenceCompletenessEnvelope
  });
}
