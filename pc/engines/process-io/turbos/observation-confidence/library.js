/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated observation-confidence library. It validates, aggregates, and
 * plans metric-completeness reports without importing the turbo or changing
 * process state.
 */

export const PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_ID = 'process-io.observation-confidence.library';
export const PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'low-confidence-sustained', 'low-confidence-observed', 'complete-observation',
  'no-processes', 'observation-disabled', 'incomplete-confidence-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ratio(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Observation-confidence library ${label} must be between 0 and 1`);
  }
  return value;
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Observation-confidence library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Observation-confidence library report must be an object');
  if (report.turbo !== 'process-io.observation-confidence') {
    throw new Error('Observation-confidence library requires an observation-confidence turbo report');
  }
  if (!STATES.includes(report.state)) {
    throw new Error('Observation-confidence library report has an invalid state');
  }
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Observation-confidence library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Observation-confidence library minimumSamples must be from 1 to 64');
  }
  ratio(report.completenessThreshold, 'completenessThreshold');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Observation-confidence library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['disabledCount', 'disabled count'], ['noProcessCount', 'no-process count'],
    ['lowConfidenceCount', 'low-confidence count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.processCount) || report.processCount < 0 || report.processCount > 4096) {
    throw new RangeError('Observation-confidence library processCount must be from 0 to 4096');
  }
  if (!Number.isInteger(report.completeProcessCount) || report.completeProcessCount < 0
    || report.completeProcessCount > report.processCount) {
    throw new RangeError('Observation-confidence library completeProcessCount must fit inside processCount');
  }
  ratio(report.latestObservationRate, 'latestObservationRate');
  ratio(report.confidence, 'confidence');
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Observation-confidence library reports must be an array');
  if (reports.length > 64) throw new RangeError('Observation-confidence library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-processes')) return 'no-processes';
  if (reports.some((report) => report.state === 'observation-disabled')) return 'observation-disabled';
  if (reports.some((report) => report.state === 'incomplete-confidence-evidence')) return 'incomplete-confidence-evidence';
  if (reports.some((report) => report.state === 'low-confidence-sustained')) return 'low-confidence-sustained';
  if (reports.some((report) => report.state === 'low-confidence-observed')) return 'low-confidence-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'complete-observation';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-process-io-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-io-review']);
  if (state === 'observation-disabled') return Object.freeze(['keep-process-io-observation-disabled']);
  if (state === 'incomplete-confidence-evidence') return Object.freeze(['request-process-io-observation']);
  if (state === 'low-confidence-sustained') {
    return Object.freeze(['review-process-io-sensor-coverage', 'hold-unapproved-io-policy']);
  }
  if (state === 'low-confidence-observed') return Object.freeze(['observe-next-process-io-sample']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'low-confidence-sustained') return 'sensor-coverage-review';
  if (state === 'low-confidence-observed') return 'sensor-coverage-observation';
  if (state === 'no-processes') return 'no-process-observation';
  if (state === 'observation-disabled') return 'disabled-observation';
  if (state === 'incomplete-confidence-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'complete-observation';
}

function intervalFor(state, environment) {
  if (state === 'low-confidence-sustained') return 750;
  if (state === 'low-confidence-observed') return 1000;
  if (state === 'no-processes' || state === 'observation-disabled') return 10000;
  if (state === 'incomplete-confidence-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { processCount: 0, completeProcessCount: 0, latestObservationRate: 0 };
}

export function mergeProcessIoObservationConfidenceReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_ID,
    libraryVersion: PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    processCount: last.processCount,
    completeProcessCount: last.completeProcessCount,
    latestObservationRate: last.latestObservationRate,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    disabledCount: validated.reduce((sum, report) => sum + report.disabledCount, 0),
    noProcessCount: validated.reduce((sum, report) => sum + report.noProcessCount, 0),
    lowConfidenceCount: validated.reduce((sum, report) => sum + report.lowConfidenceCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildProcessIoObservationConfidencePlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Observation-confidence library clock must return a number');
  return timestamp;
}

export function buildProcessIoObservationConfidenceEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Observation-confidence library trigger is required');
  }
  return Object.freeze({
    library: PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_ID,
    libraryVersion: PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createProcessIoObservationConfidenceLibrary() {
  return Object.freeze({
    id: PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_ID,
    version: PROCESS_IO_OBSERVATION_CONFIDENCE_LIBRARY_VERSION,
    merge: mergeProcessIoObservationConfidenceReports,
    plan: buildProcessIoObservationConfidencePlan,
    envelope: buildProcessIoObservationConfidenceEnvelope
  });
}
