/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated state-coverage library. It validates, aggregates, and plans
 * documented process-state reports without importing the turbo or changing
 * process state.
 */

export const PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_ID = 'process-lifecycle.state-coverage.library';
export const PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'state-coverage-low-sustained', 'state-coverage-low-observed', 'complete-state-observation',
  'no-processes', 'incomplete-state-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ratio(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`State-coverage library ${label} must be between 0 and 1`);
  }
  return value;
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`State-coverage library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('State-coverage library report must be an object');
  if (report.turbo !== 'process-lifecycle.state-coverage') {
    throw new Error('State-coverage library requires a state-coverage turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('State-coverage library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('State-coverage library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('State-coverage library minimumSamples must be from 1 to 64');
  }
  ratio(report.coverageThreshold, 'coverageThreshold');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('State-coverage library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noProcessCount', 'no-process count'], ['lowCoverageCount', 'low-coverage count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.processCount) || report.processCount < 0 || report.processCount > 4096) {
    throw new RangeError('State-coverage library processCount must be from 0 to 4096');
  }
  if (!Number.isInteger(report.knownStateCount) || report.knownStateCount < 0
    || report.knownStateCount > report.processCount) {
    throw new RangeError('State-coverage library knownStateCount must fit inside processCount');
  }
  ratio(report.latestCoverage, 'latestCoverage');
  ratio(report.confidence, 'confidence');
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('State-coverage library reports must be an array');
  if (reports.length > 64) throw new RangeError('State-coverage library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-processes')) return 'no-processes';
  if (reports.some((report) => report.state === 'incomplete-state-evidence')) return 'incomplete-state-evidence';
  if (reports.some((report) => report.state === 'state-coverage-low-sustained')) return 'state-coverage-low-sustained';
  if (reports.some((report) => report.state === 'state-coverage-low-observed')) return 'state-coverage-low-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'complete-state-observation';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-state-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-lifecycle-review']);
  if (state === 'incomplete-state-evidence') return Object.freeze(['request-process-state-observation']);
  if (state === 'state-coverage-low-sustained') return Object.freeze(['review-process-state-coverage', 'hold-unknown-state-policy']);
  if (state === 'state-coverage-low-observed') return Object.freeze(['observe-next-state-sample']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'state-coverage-low-sustained') return 'state-coverage-review';
  if (state === 'state-coverage-low-observed') return 'state-coverage-observation';
  if (state === 'no-processes') return 'no-process-observation';
  if (state === 'incomplete-state-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'complete-state-observation';
}

function intervalFor(state, environment) {
  if (state === 'state-coverage-low-sustained') return 750;
  if (state === 'state-coverage-low-observed') return 1000;
  if (state === 'no-processes') return 10000;
  if (state === 'incomplete-state-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { processCount: 0, knownStateCount: 0, latestCoverage: 0 };
}

export function mergeProcessLifecycleStateCoverageReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_ID,
    libraryVersion: PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    processCount: last.processCount,
    knownStateCount: last.knownStateCount,
    latestCoverage: last.latestCoverage,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noProcessCount: validated.reduce((sum, report) => sum + report.noProcessCount, 0),
    lowCoverageCount: validated.reduce((sum, report) => sum + report.lowCoverageCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildProcessLifecycleStateCoveragePlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('State-coverage library clock must return a number');
  return timestamp;
}

export function buildProcessLifecycleStateCoverageEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('State-coverage library trigger is required');
  }
  return Object.freeze({
    library: PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_ID,
    libraryVersion: PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createProcessLifecycleStateCoverageLibrary() {
  return Object.freeze({
    id: PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_ID,
    version: PROCESS_LIFECYCLE_STATE_COVERAGE_LIBRARY_VERSION,
    merge: mergeProcessLifecycleStateCoverageReports,
    plan: buildProcessLifecycleStateCoveragePlan,
    envelope: buildProcessLifecycleStateCoverageEnvelope
  });
}
