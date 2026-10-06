/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated identity-completeness library. It validates, aggregates, and
 * plans driver identity reports without importing the turbo or changing data.
 */

export const DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_ID = 'driver-capability.identity-completeness.library';
export const DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'identity-gap-sustained', 'identity-gap-observed', 'complete-identity',
  'no-drivers', 'incomplete-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Identity-completeness library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Identity-completeness library report must be an object');
  if (report.turbo !== 'driver-capability.identity-completeness') {
    throw new Error('Identity-completeness library requires an identity-completeness turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Identity-completeness library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Identity-completeness library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Identity-completeness library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Identity-completeness library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noDriverCount', 'no-driver count'], ['gapSampleCount', 'gap sample count'],
    ['sustainedGapCount', 'sustained-gap sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.driverCount) || report.driverCount < 0 || report.driverCount > 4096) {
    throw new RangeError('Identity-completeness library driverCount must be from 0 to 4096');
  }
  for (const [field, label] of [
    ['completeCount', 'complete count'], ['incompleteRowCount', 'incomplete row count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.driverCount) {
      throw new RangeError(`Identity-completeness library ${label} must fit inside driverCount`);
    }
  }
  if (!Number.isInteger(report.missingFieldCount) || report.missingFieldCount < 0
    || report.missingFieldCount > report.driverCount * 4) {
    throw new RangeError('Identity-completeness library missingFieldCount must fit inside driver identity fields');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Identity-completeness library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Identity-completeness library reports must be an array');
  if (reports.length > 64) throw new RangeError('Identity-completeness library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-drivers')) return 'no-drivers';
  if (reports.some((report) => report.state === 'incomplete-evidence')) return 'incomplete-evidence';
  if (reports.some((report) => report.state === 'identity-gap-sustained')) return 'identity-gap-sustained';
  if (reports.some((report) => report.state === 'identity-gap-observed')) return 'identity-gap-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'complete-identity';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-driver-identity']);
  if (state === 'no-drivers') return Object.freeze(['no-driver-identity-review']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-environment-profile']);
  if (state === 'identity-gap-sustained') return Object.freeze(['review-driver-identity-source-without-change']);
  if (state === 'identity-gap-observed') return Object.freeze(['request-driver-identity-observation']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'identity-gap-sustained') return 'driver-identity-review';
  if (state === 'identity-gap-observed') return 'driver-identity-observation';
  if (state === 'no-drivers') return 'no-driver-observation';
  if (state === 'incomplete-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'complete-identity-observation';
}

function intervalFor(state, environment) {
  if (state === 'identity-gap-sustained') return 750;
  if (state === 'identity-gap-observed') return 1000;
  if (state === 'no-drivers') return 10000;
  if (state === 'incomplete-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || {
    driverCount: 0, completeCount: 0, incompleteRowCount: 0, missingFieldCount: 0
  };
}

export function mergeDriverCapabilityIdentityCompletenessReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_ID,
    libraryVersion: DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    driverCount: last.driverCount,
    completeCount: last.completeCount,
    incompleteRowCount: last.incompleteRowCount,
    missingFieldCount: last.missingFieldCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDriverCount: validated.reduce((sum, report) => sum + report.noDriverCount, 0),
    gapSampleCount: validated.reduce((sum, report) => sum + report.gapSampleCount, 0),
    sustainedGapCount: validated.reduce((sum, report) => sum + report.sustainedGapCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildDriverCapabilityIdentityCompletenessPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Identity-completeness library clock must return a number');
  return timestamp;
}

export function buildDriverCapabilityIdentityCompletenessEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Identity-completeness library trigger is required');
  }
  return Object.freeze({
    library: DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_ID,
    libraryVersion: DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createDriverCapabilityIdentityCompletenessLibrary() {
  return Object.freeze({
    id: DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_ID,
    version: DRIVER_CAPABILITY_IDENTITY_COMPLETENESS_LIBRARY_VERSION,
    merge: mergeDriverCapabilityIdentityCompletenessReports,
    plan: buildDriverCapabilityIdentityCompletenessPlan,
    envelope: buildDriverCapabilityIdentityCompletenessEnvelope
  });
}
