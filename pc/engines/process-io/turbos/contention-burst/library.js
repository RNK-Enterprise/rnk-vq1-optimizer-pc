/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated contention-burst library. It validates, aggregates, and plans
 * I/O-wait reports without importing the turbo or changing process state.
 */

export const PROCESS_IO_CONTENTION_BURST_LIBRARY_ID = 'process-io.contention-burst.library';
export const PROCESS_IO_CONTENTION_BURST_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'contention-sustained', 'contention-observed', 'stable-contention',
  'no-processes', 'observation-disabled', 'incomplete-contention-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rate(value, label) {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new RangeError(`Contention-burst library ${label} must be null or non-negative`);
  }
  return value;
}

function percent(value, label) {
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
    throw new RangeError(`Contention-burst library ${label} must be null or between 0 and 100`);
  }
  return value;
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Contention-burst library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Contention-burst library report must be an object');
  if (report.turbo !== 'process-io.contention-burst') {
    throw new Error('Contention-burst library requires a contention-burst turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Contention-burst library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0) {
    throw new RangeError('Contention-burst library report sampleCount must be non-negative');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Contention-burst library minimumSamples must be from 1 to 64');
  }
  if (!Number.isFinite(report.contentionThreshold) || report.contentionThreshold < 0
    || report.contentionThreshold > 100) {
    throw new RangeError('Contention-burst library contentionThreshold must be between 0 and 100');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Contention-burst library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['disabledCount', 'disabled count'], ['noProcessCount', 'no-process count'],
    ['contentionCount', 'contention count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.processCount) || report.processCount < 0 || report.processCount > 4096) {
    throw new RangeError('Contention-burst library processCount must be from 0 to 4096');
  }
  percent(report.maximumWaitPercent, 'maximumWaitPercent');
  rate(report.totalReadBytesPerSecond, 'totalReadBytesPerSecond');
  rate(report.totalWriteBytesPerSecond, 'totalWriteBytesPerSecond');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Contention-burst library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Contention-burst library reports must be an array');
  if (reports.length > 64) throw new RangeError('Contention-burst library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-processes')) return 'no-processes';
  if (reports.some((report) => report.state === 'observation-disabled')) return 'observation-disabled';
  if (reports.some((report) => report.state === 'incomplete-contention-evidence')) return 'incomplete-contention-evidence';
  if (reports.some((report) => report.state === 'contention-sustained')) return 'contention-sustained';
  if (reports.some((report) => report.state === 'contention-observed')) return 'contention-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-contention';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-contention-samples']);
  if (state === 'no-processes') return Object.freeze(['no-process-io-review']);
  if (state === 'observation-disabled') return Object.freeze(['keep-process-io-observation-disabled']);
  if (state === 'incomplete-contention-evidence') return Object.freeze(['request-process-io-observation']);
  if (state === 'contention-sustained') return Object.freeze(['protect-services', 'review-storage-contention']);
  if (state === 'contention-observed') return Object.freeze(['observe-next-contention-sample']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'contention-sustained') return 'contention-review';
  if (state === 'contention-observed') return 'contention-observation';
  if (state === 'no-processes') return 'no-process-observation';
  if (state === 'observation-disabled') return 'disabled-observation';
  if (state === 'incomplete-contention-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-contention-observation';
}

function intervalFor(state, environment) {
  if (state === 'contention-sustained') return 750;
  if (state === 'contention-observed') return 1000;
  if (state === 'no-processes') return 10000;
  if (state === 'observation-disabled') return 10000;
  if (state === 'incomplete-contention-evidence') return 1500;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { processCount: 0, maximumWaitPercent: null, totalReadBytesPerSecond: null, totalWriteBytesPerSecond: null };
}

export function mergeProcessIoContentionBurstReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: PROCESS_IO_CONTENTION_BURST_LIBRARY_ID,
    libraryVersion: PROCESS_IO_CONTENTION_BURST_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    processCount: last.processCount,
    maximumWaitPercent: last.maximumWaitPercent,
    totalReadBytesPerSecond: last.totalReadBytesPerSecond,
    totalWriteBytesPerSecond: last.totalWriteBytesPerSecond,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    disabledCount: validated.reduce((sum, report) => sum + report.disabledCount, 0),
    noProcessCount: validated.reduce((sum, report) => sum + report.noProcessCount, 0),
    contentionCount: validated.reduce((sum, report) => sum + report.contentionCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildProcessIoContentionBurstPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: PROCESS_IO_CONTENTION_BURST_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Contention-burst library clock must return a number');
  return timestamp;
}

export function buildProcessIoContentionBurstEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Contention-burst library trigger is required');
  }
  return Object.freeze({
    library: PROCESS_IO_CONTENTION_BURST_LIBRARY_ID,
    libraryVersion: PROCESS_IO_CONTENTION_BURST_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createProcessIoContentionBurstLibrary() {
  return Object.freeze({
    id: PROCESS_IO_CONTENTION_BURST_LIBRARY_ID,
    version: PROCESS_IO_CONTENTION_BURST_LIBRARY_VERSION,
    merge: mergeProcessIoContentionBurstReports,
    plan: buildProcessIoContentionBurstPlan,
    envelope: buildProcessIoContentionBurstEnvelope
  });
}
