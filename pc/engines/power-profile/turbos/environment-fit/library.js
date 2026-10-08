/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated environment-fit library. It validates, aggregates, and plans
 * posture reports without selecting a user-owned power profile.
 */

export const POWER_PROFILE_ENVIRONMENT_LIBRARY_ID = 'power-profile.environment-fit.library';
export const POWER_PROFILE_ENVIRONMENT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'profile-aligned', 'profile-mismatch-observed', 'profile-mismatch-sustained',
  'custom-profile-review', 'environment-unknown', 'profile-unknown', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const PROFILES = Object.freeze(['powersave', 'balanced', 'performance', 'custom', 'unknown']);
const TARGETS = Object.freeze(['balanced', 'performance']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleBound(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Environment-fit library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireComparisonBound(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.comparisonCount) {
    throw new RangeError(`Environment-fit library report ${label} must fit inside comparisonCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Environment-fit library report must be an object');
  if (report.turbo !== 'power-profile.environment-fit') {
    throw new Error('Environment-fit library requires an environment-fit turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Environment-fit library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Environment-fit library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Environment-fit library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.mismatchThreshold) || report.mismatchThreshold < 1
    || report.mismatchThreshold > 64) {
    throw new RangeError('Environment-fit library mismatchThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['environmentUnknownCount', 'environment-unknown count'],
    ['profileUnknownCount', 'profile-unknown count'], ['customCount', 'custom count'],
    ['mismatchCount', 'mismatch count'], ['alignedCount', 'aligned count'], ['knownCount', 'known count']
  ]) requireSampleBound(report, field, label);
  if (!Number.isInteger(report.comparisonCount) || report.comparisonCount < 0
    || report.comparisonCount > Math.max(0, report.sampleCount - 1)) {
    throw new RangeError('Environment-fit library comparisonCount must fit inside the sample window');
  }
  for (const [field, label] of [
    ['fitChangeCount', 'fit-change count'],
    ['environmentChangeCount', 'environment-change count'],
    ['profileChangeCount', 'profile-change count']
  ]) requireComparisonBound(report, field, label);
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) {
    throw new TypeError('Environment-fit library finalEnvironment must be normalized');
  }
  if (!PROFILES.includes(report.finalProfile)) {
    throw new TypeError('Environment-fit library finalProfile must be normalized');
  }
  if (report.finalTarget !== null && !TARGETS.includes(report.finalTarget)) {
    throw new TypeError('Environment-fit library finalTarget must be a known target or null');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Environment-fit library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Environment-fit library reports must be an array');
  if (reports.length > 64) throw new RangeError('Environment-fit library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'profile-mismatch-sustained')) {
    return 'profile-mismatch-sustained';
  }
  if (reports.some((report) => report.state === 'custom-profile-review')) return 'custom-profile-review';
  if (reports.some((report) => report.state === 'profile-mismatch-observed')) {
    return 'profile-mismatch-observed';
  }
  if (reports.every((report) => report.state === 'environment-unknown')) return 'environment-unknown';
  if (reports.every((report) => report.state === 'profile-unknown')) return 'profile-unknown';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'profile-aligned';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const known = reports.reduce((sum, report) => sum + report.knownCount, 0);
  return Math.round((known / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-environment-profile-samples']);
  if (state === 'environment-unknown') return Object.freeze(['request-environment-profile']);
  if (state === 'profile-unknown') return Object.freeze(['request-active-profile-observation']);
  if (state === 'custom-profile-review') return Object.freeze(['review-user-owned-custom-profile']);
  if (state === 'profile-mismatch-sustained') return Object.freeze(['review-profile-fit-without-switching']);
  if (state === 'profile-mismatch-observed') return Object.freeze(['observe-profile-fit-stability']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'profile-mismatch-sustained') return 'fit-review';
  if (state === 'profile-mismatch-observed') return 'fit-observation';
  if (state === 'custom-profile-review') return 'custom-review';
  if (state === 'environment-unknown') return 'environment-bootstrap';
  if (state === 'profile-unknown') return 'profile-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}

function intervalFor(state, environment) {
  if (state === 'profile-mismatch-sustained') return 1000;
  if (state === 'profile-mismatch-observed') return 1500;
  if (state === 'custom-profile-review') return 2000;
  if (state === 'environment-unknown' || state === 'profile-unknown') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergePowerProfileEnvironmentReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const latest = validated.at(-1);
  return Object.freeze({
    library: POWER_PROFILE_ENVIRONMENT_LIBRARY_ID,
    libraryVersion: POWER_PROFILE_ENVIRONMENT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    environmentUnknownCount: validated.reduce((sum, report) => sum + report.environmentUnknownCount, 0),
    profileUnknownCount: validated.reduce((sum, report) => sum + report.profileUnknownCount, 0),
    customCount: validated.reduce((sum, report) => sum + report.customCount, 0),
    mismatchCount: validated.reduce((sum, report) => sum + report.mismatchCount, 0),
    alignedCount: validated.reduce((sum, report) => sum + report.alignedCount, 0),
    knownCount: validated.reduce((sum, report) => sum + report.knownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    fitChangeCount: validated.reduce((sum, report) => sum + report.fitChangeCount, 0),
    environmentChangeCount: validated.reduce((sum, report) => sum + report.environmentChangeCount, 0),
    profileChangeCount: validated.reduce((sum, report) => sum + report.profileChangeCount, 0),
    finalEnvironment: latest?.finalEnvironment || 'unknown',
    finalProfile: latest?.finalProfile || 'unknown',
    finalTarget: latest?.finalTarget || null,
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildPowerProfileEnvironmentPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: POWER_PROFILE_ENVIRONMENT_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0 ? 0
      : Math.round((validated.knownCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Environment-fit library clock must return a number');
  return timestamp;
}

export function buildPowerProfileEnvironmentEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Environment-fit library trigger is required');
  }
  return Object.freeze({
    library: POWER_PROFILE_ENVIRONMENT_LIBRARY_ID,
    libraryVersion: POWER_PROFILE_ENVIRONMENT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createPowerProfileEnvironmentLibrary() {
  return Object.freeze({
    id: POWER_PROFILE_ENVIRONMENT_LIBRARY_ID,
    version: POWER_PROFILE_ENVIRONMENT_LIBRARY_VERSION,
    merge: mergePowerProfileEnvironmentReports,
    plan: buildPowerProfileEnvironmentPlan,
    envelope: buildPowerProfileEnvironmentEnvelope
  });
}
