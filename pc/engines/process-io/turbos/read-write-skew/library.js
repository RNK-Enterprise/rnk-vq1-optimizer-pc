/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated read-write-skew library. It validates, aggregates, and plans I/O
 * direction reports without importing the turbo or changing process state.
 */

export const PROCESS_IO_READ_WRITE_SKEW_LIBRARY_ID = 'process-io.read-write-skew.library';
export const PROCESS_IO_READ_WRITE_SKEW_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'read-skew-sustained', 'write-skew-sustained', 'io-skew-observed', 'balanced-io',
  'no-processes', 'observation-disabled', 'incomplete-read-write-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rate(value, label) {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new RangeError(`Read-write-skew library ${label} must be null or non-negative`);
  }
  return value;
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Read-write-skew library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Read-write-skew library report must be an object');
  if (report.turbo !== 'process-io.read-write-skew') {
    throw new Error('Read-write-skew library requires a read-write-skew turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Read-write-skew library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Read-write-skew library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Read-write-skew library minimumSamples must be from 1 to 64');
  }
  if (!Number.isFinite(report.skewRatio) || report.skewRatio < 1 || report.skewRatio > 100) {
    throw new RangeError('Read-write-skew library skewRatio must be between 1 and 100');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Read-write-skew library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['disabledCount', 'disabled count'], ['noProcessCount', 'no-process count'],
    ['readSkewCount', 'read-skew count'], ['writeSkewCount', 'write-skew count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.processCount) || report.processCount < 0 || report.processCount > 4096) {
    throw new RangeError('Read-write-skew library processCount must be from 0 to 4096');
  }
  rate(report.totalReadBytesPerSecond, 'totalReadBytesPerSecond');
  rate(report.totalWriteBytesPerSecond, 'totalWriteBytesPerSecond');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Read-write-skew library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Read-write-skew library reports must be an array');
  if (reports.length > 64) throw new RangeError('Read-write-skew library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-processes')) return 'no-processes';
  if (reports.some((report) => report.state === 'observation-disabled')) return 'observation-disabled';
  if (reports.some((report) => report.state === 'incomplete-read-write-evidence')) return 'incomplete-read-write-evidence';
  if (reports.some((report) => report.state === 'read-skew-sustained')) return 'read-skew-sustained';
  if (reports.some((report) => report.state === 'write-skew-sustained')) return 'write-skew-sustained';
  if (reports.some((report) => report.state === 'io-skew-observed')) return 'io-skew-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'balanced-io';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-read-write-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-io-review']);
  if (state === 'observation-disabled') return Object.freeze(['keep-process-io-observation-disabled']);
  if (state === 'incomplete-read-write-evidence') return Object.freeze(['request-process-io-observation']);
  if (state === 'read-skew-sustained') return Object.freeze(['review-read-contention']);
  if (state === 'write-skew-sustained') return Object.freeze(['review-write-contention']);
  if (state === 'io-skew-observed') return Object.freeze(['observe-next-read-write-sample']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'read-skew-sustained') return 'read-contention-review';
  if (state === 'write-skew-sustained') return 'write-contention-review';
  if (state === 'io-skew-observed') return 'io-skew-observation';
  if (state === 'no-processes') return 'no-process-observation';
  if (state === 'observation-disabled') return 'disabled-observation';
  if (state === 'incomplete-read-write-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'balanced-io-observation';
}

function intervalFor(state, environment) {
  if (state === 'read-skew-sustained' || state === 'write-skew-sustained') return 750;
  if (state === 'io-skew-observed') return 1000;
  if (state === 'no-processes' || state === 'observation-disabled') return 10000;
  if (state === 'incomplete-read-write-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { processCount: 0, totalReadBytesPerSecond: null, totalWriteBytesPerSecond: null };
}

export function mergeProcessIoReadWriteSkewReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: PROCESS_IO_READ_WRITE_SKEW_LIBRARY_ID,
    libraryVersion: PROCESS_IO_READ_WRITE_SKEW_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    processCount: last.processCount,
    totalReadBytesPerSecond: last.totalReadBytesPerSecond,
    totalWriteBytesPerSecond: last.totalWriteBytesPerSecond,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    disabledCount: validated.reduce((sum, report) => sum + report.disabledCount, 0),
    noProcessCount: validated.reduce((sum, report) => sum + report.noProcessCount, 0),
    readSkewCount: validated.reduce((sum, report) => sum + report.readSkewCount, 0),
    writeSkewCount: validated.reduce((sum, report) => sum + report.writeSkewCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildProcessIoReadWriteSkewPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: PROCESS_IO_READ_WRITE_SKEW_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Read-write-skew library clock must return a number');
  return timestamp;
}

export function buildProcessIoReadWriteSkewEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Read-write-skew library trigger is required');
  }
  return Object.freeze({
    library: PROCESS_IO_READ_WRITE_SKEW_LIBRARY_ID,
    libraryVersion: PROCESS_IO_READ_WRITE_SKEW_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createProcessIoReadWriteSkewLibrary() {
  return Object.freeze({
    id: PROCESS_IO_READ_WRITE_SKEW_LIBRARY_ID,
    version: PROCESS_IO_READ_WRITE_SKEW_LIBRARY_VERSION,
    merge: mergeProcessIoReadWriteSkewReports,
    plan: buildProcessIoReadWriteSkewPlan,
    envelope: buildProcessIoReadWriteSkewEnvelope
  });
}
