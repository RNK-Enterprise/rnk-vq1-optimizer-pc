/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated profile-drift library. It validates, aggregates, and plans
 * profile-change reports without importing a system-control API.
 */

export const POWER_PROFILE_DRIFT_LIBRARY_ID = 'power-profile.profile-drift.library';
export const POWER_PROFILE_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-profile', 'profile-drift-observed', 'availability-drift',
  'profile-drift-sustained', 'control-disabled', 'profile-unknown', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const PROFILES = Object.freeze(['powersave', 'balanced', 'performance', 'custom', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleBound(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Profile-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireComparisonBound(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.comparisonCount) {
    throw new RangeError(`Profile-drift library report ${label} must fit inside comparisonCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Profile-drift library report must be an object');
  if (report.turbo !== 'power-profile.profile-drift') {
    throw new Error('Profile-drift library requires a profile-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Profile-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Profile-drift library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Profile-drift library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Profile-drift library persistenceThreshold must be from 1 to 64');
  }
  requireSampleBound(report, 'observedCount', 'observed count');
  requireSampleBound(report, 'unknownCount', 'unknown count');
  requireSampleBound(report, 'controlDisabledCount', 'control-disabled count');
  if (!Number.isInteger(report.comparisonCount) || report.comparisonCount < 0
    || report.comparisonCount > Math.max(0, report.sampleCount - 1)) {
    throw new RangeError('Profile-drift library comparisonCount must fit inside the sample window');
  }
  for (const [field, label] of [
    ['activeChangeCount', 'active-change count'],
    ['availabilityChangeCount', 'availability-change count'],
    ['controlChangeCount', 'control-change count']
  ]) requireComparisonBound(report, field, label);
  if (typeof report.finalProfile !== 'string' || !PROFILES.includes(report.finalProfile)) {
    throw new TypeError('Profile-drift library finalProfile must be a normalized profile');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Profile-drift library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Profile-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Profile-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'control-disabled')) return 'control-disabled';
  if (reports.some((report) => report.state === 'profile-drift-sustained')) return 'profile-drift-sustained';
  if (reports.some((report) => report.state === 'availability-drift')) return 'availability-drift';
  if (reports.some((report) => report.state === 'profile-drift-observed')) return 'profile-drift-observed';
  if (reports.every((report) => report.state === 'profile-unknown')) return 'profile-unknown';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-profile';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-profile-samples']);
  if (state === 'profile-unknown') return Object.freeze(['request-active-profile-observation']);
  if (state === 'control-disabled') return Object.freeze(['preserve-power-profile-control-boundary']);
  if (state === 'profile-drift-sustained') return Object.freeze(['review-profile-drift-without-switching']);
  if (state === 'availability-drift') return Object.freeze(['observe-available-profile-stability']);
  if (state === 'profile-drift-observed') return Object.freeze(['observe-active-profile-stability']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'control-disabled') return 'control-preservation';
  if (state === 'profile-drift-sustained') return 'profile-review';
  if (state === 'availability-drift') return 'availability-observation';
  if (state === 'profile-drift-observed') return 'profile-observation';
  if (state === 'profile-unknown') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}

function intervalFor(state, environment) {
  if (state === 'control-disabled') return 10000;
  if (state === 'profile-drift-sustained') return 750;
  if (state === 'availability-drift' || state === 'profile-drift-observed') return 1500;
  if (state === 'profile-unknown') return 2000;
  if (state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergePowerProfileDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const latest = validated.at(-1);
  return Object.freeze({
    library: POWER_PROFILE_DRIFT_LIBRARY_ID,
    libraryVersion: POWER_PROFILE_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    controlDisabledCount: validated.reduce((sum, report) => sum + report.controlDisabledCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    activeChangeCount: validated.reduce((sum, report) => sum + report.activeChangeCount, 0),
    availabilityChangeCount: validated.reduce((sum, report) => sum + report.availabilityChangeCount, 0),
    controlChangeCount: validated.reduce((sum, report) => sum + report.controlChangeCount, 0),
    finalProfile: latest?.finalProfile || 'unknown',
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildPowerProfileDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: POWER_PROFILE_DRIFT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Profile-drift library clock must return a number');
  return timestamp;
}

export function buildPowerProfileDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Profile-drift library trigger is required');
  }
  return Object.freeze({
    library: POWER_PROFILE_DRIFT_LIBRARY_ID,
    libraryVersion: POWER_PROFILE_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createPowerProfileDriftLibrary() {
  return Object.freeze({
    id: POWER_PROFILE_DRIFT_LIBRARY_ID,
    version: POWER_PROFILE_DRIFT_LIBRARY_VERSION,
    merge: mergePowerProfileDriftReports,
    plan: buildPowerProfileDriftPlan,
    envelope: buildPowerProfileDriftEnvelope
  });
}
