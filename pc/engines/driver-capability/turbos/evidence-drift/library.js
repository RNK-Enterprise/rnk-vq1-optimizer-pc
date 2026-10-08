/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated evidence-drift library. It validates immutable turbo reports,
 * merges driver evidence, and plans observation without changing drivers.
 */

export const DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_ID = 'driver-capability.evidence-drift.library';
export const DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'unverified-sustained', 'evidence-review-observed', 'documented-drivers',
  'no-drivers', 'incomplete-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Evidence-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Evidence-drift library report must be an object');
  if (report.turbo !== 'driver-capability.evidence-drift') {
    throw new Error('Evidence-drift library requires an evidence-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Evidence-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Evidence-drift library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Evidence-drift library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Evidence-drift library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noDriverCount', 'no-driver count'], ['reviewSampleCount', 'review sample count'],
    ['unverifiedSampleCount', 'unverified sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.driverCount) || report.driverCount < 0 || report.driverCount > 4096) {
    throw new RangeError('Evidence-drift library driverCount must be from 0 to 4096');
  }
  for (const [field, label] of [
    ['unverifiedCount', 'unverified count'], ['unknownCount', 'unknown count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.driverCount) {
      throw new RangeError(`Evidence-drift library ${label} must fit inside driverCount`);
    }
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Evidence-drift library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Evidence-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Evidence-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-drivers')) return 'no-drivers';
  if (reports.some((report) => report.state === 'incomplete-evidence')) return 'incomplete-evidence';
  if (reports.some((report) => report.state === 'unverified-sustained')) return 'unverified-sustained';
  if (reports.some((report) => report.state === 'evidence-review-observed')) return 'evidence-review-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'documented-drivers';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-driver-evidence']);
  if (state === 'no-drivers') return Object.freeze(['no-driver-capability-review']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-environment-profile']);
  if (state === 'unverified-sustained') return Object.freeze(['review-driver-source-without-change']);
  if (state === 'evidence-review-observed') return Object.freeze(['request-driver-capability-observation']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'unverified-sustained') return 'driver-source-review';
  if (state === 'evidence-review-observed') return 'driver-evidence-observation';
  if (state === 'no-drivers') return 'no-driver-observation';
  if (state === 'incomplete-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'documented-driver-observation';
}

function intervalFor(state, environment) {
  if (state === 'unverified-sustained') return 750;
  if (state === 'evidence-review-observed') return 1000;
  if (state === 'no-drivers') return 10000;
  if (state === 'incomplete-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || {
    driverCount: 0, unverifiedCount: 0, unknownCount: 0,
    observedCount: 0, incompleteCount: 0, noDriverCount: 0
  };
}

export function mergeDriverCapabilityEvidenceDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_ID,
    libraryVersion: DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    driverCount: last.driverCount,
    unverifiedCount: last.unverifiedCount,
    unknownCount: last.unknownCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDriverCount: validated.reduce((sum, report) => sum + report.noDriverCount, 0),
    reviewSampleCount: validated.reduce((sum, report) => sum + report.reviewSampleCount, 0),
    unverifiedSampleCount: validated.reduce((sum, report) => sum + report.unverifiedSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildDriverCapabilityEvidenceDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Evidence-drift library clock must return a number');
  return timestamp;
}

export function buildDriverCapabilityEvidenceDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Evidence-drift library trigger is required');
  }
  return Object.freeze({
    library: DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_ID,
    libraryVersion: DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createDriverCapabilityEvidenceDriftLibrary() {
  return Object.freeze({
    id: DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_ID,
    version: DRIVER_CAPABILITY_EVIDENCE_DRIFT_LIBRARY_VERSION,
    merge: mergeDriverCapabilityEvidenceDriftReports,
    plan: buildDriverCapabilityEvidenceDriftPlan,
    envelope: buildDriverCapabilityEvidenceDriftEnvelope
  });
}
