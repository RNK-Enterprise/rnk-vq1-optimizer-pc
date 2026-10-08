/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated version-churn library. It validates, aggregates, and plans driver
 * version observations without importing the turbo or changing drivers.
 */

export const DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_ID = 'driver-capability.version-churn.library';
export const DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'version-churn-sustained', 'version-churn-observed', 'stable-versions',
  'no-drivers', 'incomplete-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Version-churn library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Version-churn library report must be an object');
  if (report.turbo !== 'driver-capability.version-churn') {
    throw new Error('Version-churn library requires a version-churn turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Version-churn library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Version-churn library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Version-churn library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Version-churn library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noDriverCount', 'no-driver count'], ['comparisonCount', 'comparison count'],
    ['versionChangeSampleCount', 'version-change sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.driverCount) || report.driverCount < 0 || report.driverCount > 4096) {
    throw new RangeError('Version-churn library driverCount must be from 0 to 4096');
  }
  if (!Number.isInteger(report.versionChangeCount) || report.versionChangeCount < 0
    || report.versionChangeCount > report.driverCount) {
    throw new RangeError('Version-churn library versionChangeCount must fit inside driverCount');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Version-churn library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Version-churn library reports must be an array');
  if (reports.length > 64) throw new RangeError('Version-churn library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-drivers')) return 'no-drivers';
  if (reports.some((report) => report.state === 'incomplete-evidence')) return 'incomplete-evidence';
  if (reports.some((report) => report.state === 'version-churn-sustained')) return 'version-churn-sustained';
  if (reports.some((report) => report.state === 'version-churn-observed')) return 'version-churn-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-versions';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-driver-versions']);
  if (state === 'no-drivers') return Object.freeze(['no-driver-version-review']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-driver-version-evidence']);
  if (state === 'version-churn-sustained') return Object.freeze(['review-driver-version-churn-without-change']);
  if (state === 'version-churn-observed') return Object.freeze(['observe-driver-version-stability']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'version-churn-sustained') return 'driver-version-review';
  if (state === 'version-churn-observed') return 'driver-version-observation';
  if (state === 'no-drivers') return 'no-driver-observation';
  if (state === 'incomplete-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-driver-version-observation';
}

function intervalFor(state, environment) {
  if (state === 'version-churn-sustained') return 750;
  if (state === 'version-churn-observed') return 1000;
  if (state === 'no-drivers') return 10000;
  if (state === 'incomplete-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { driverCount: 0, versionChangeCount: 0 };
}

export function mergeDriverCapabilityVersionChurnReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_ID,
    libraryVersion: DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    driverCount: last.driverCount,
    versionChangeCount: last.versionChangeCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noDriverCount: validated.reduce((sum, report) => sum + report.noDriverCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    versionChangeSampleCount: validated.reduce((sum, report) => sum + report.versionChangeSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildDriverCapabilityVersionChurnPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Version-churn library clock must return a number');
  return timestamp;
}

export function buildDriverCapabilityVersionChurnEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Version-churn library trigger is required');
  }
  return Object.freeze({
    library: DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_ID,
    libraryVersion: DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createDriverCapabilityVersionChurnLibrary() {
  return Object.freeze({
    id: DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_ID,
    version: DRIVER_CAPABILITY_VERSION_CHURN_LIBRARY_VERSION,
    merge: mergeDriverCapabilityVersionChurnReports,
    plan: buildDriverCapabilityVersionChurnPlan,
    envelope: buildDriverCapabilityVersionChurnEnvelope
  });
}
