/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated availability-drift library. It validates, aggregates, and plans
 * advertised-profile reports without importing a system-control API.
 */

export const POWER_PROFILE_AVAILABILITY_LIBRARY_ID = 'power-profile.availability-drift.library';
export const POWER_PROFILE_AVAILABILITY_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-availability',
  'availability-drift-observed',
  'availability-drift-sustained',
  'active-not-advertised',
  'no-availability',
  'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleBound(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Availability library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Availability library report must be an object');
  if (report.turbo !== 'power-profile.availability-drift') {
    throw new Error('Availability library requires an availability-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Availability library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Availability library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Availability library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Availability library persistenceThreshold must be from 1 to 64');
  }
  if (!Number.isInteger(report.missingActiveThreshold) || report.missingActiveThreshold < 1
    || report.missingActiveThreshold > 64) {
    throw new RangeError('Availability library missingActiveThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['unknownCount', 'unknown count'],
    ['missingActiveCount', 'missing-active count']
  ]) requireSampleBound(report, field, label);
  if (!Number.isInteger(report.comparisonCount) || report.comparisonCount < 0
    || report.comparisonCount > Math.max(0, report.sampleCount - 1)) {
    throw new RangeError('Availability library comparisonCount must fit inside the sample window');
  }
  if (!Number.isInteger(report.availabilityChangeCount) || report.availabilityChangeCount < 0
    || report.availabilityChangeCount > report.comparisonCount) {
    throw new RangeError('Availability library availabilityChangeCount must fit inside comparisonCount');
  }
  for (const [field, label] of [['addedCount', 'added count'], ['removedCount', 'removed count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) {
      throw new RangeError(`Availability library ${label} must be from 0 to 4096`);
    }
  }
  if (!Array.isArray(report.finalAvailable) || report.finalAvailable.length > 64
    || report.finalAvailable.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError('Availability library finalAvailable must contain up to 64 names');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Availability library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Availability library reports must be an array');
  if (reports.length > 64) throw new RangeError('Availability library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'active-not-advertised')) return 'active-not-advertised';
  if (reports.some((report) => report.state === 'availability-drift-sustained')) {
    return 'availability-drift-sustained';
  }
  if (reports.some((report) => report.state === 'availability-drift-observed')) {
    return 'availability-drift-observed';
  }
  if (reports.every((report) => report.state === 'no-availability')) return 'no-availability';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-availability';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-available-profile-samples']);
  if (state === 'no-availability') return Object.freeze(['request-available-profile-observation']);
  if (state === 'active-not-advertised') return Object.freeze(['review-active-profile-membership']);
  if (state === 'availability-drift-sustained') return Object.freeze(['review-profile-availability-drift']);
  if (state === 'availability-drift-observed') return Object.freeze(['observe-profile-availability-stability']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'active-not-advertised') return 'membership-review';
  if (state === 'availability-drift-sustained') return 'availability-review';
  if (state === 'availability-drift-observed') return 'availability-observation';
  if (state === 'no-availability') return 'observation-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}

function intervalFor(state, environment) {
  if (state === 'active-not-advertised') return 750;
  if (state === 'availability-drift-sustained') return 1000;
  if (state === 'availability-drift-observed') return 1500;
  if (state === 'no-availability') return 5000;
  if (state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergePowerProfileAvailabilityReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const latest = validated.at(-1);
  return Object.freeze({
    library: POWER_PROFILE_AVAILABILITY_LIBRARY_ID,
    libraryVersion: POWER_PROFILE_AVAILABILITY_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    availabilityChangeCount: validated.reduce((sum, report) => sum + report.availabilityChangeCount, 0),
    addedCount: validated.reduce((sum, report) => sum + report.addedCount, 0),
    removedCount: validated.reduce((sum, report) => sum + report.removedCount, 0),
    missingActiveCount: validated.reduce((sum, report) => sum + report.missingActiveCount, 0),
    finalAvailable: latest?.finalAvailable || Object.freeze([]),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildPowerProfileAvailabilityPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: POWER_PROFILE_AVAILABILITY_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Availability library clock must return a number');
  return timestamp;
}

export function buildPowerProfileAvailabilityEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Availability library trigger is required');
  }
  return Object.freeze({
    library: POWER_PROFILE_AVAILABILITY_LIBRARY_ID,
    libraryVersion: POWER_PROFILE_AVAILABILITY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createPowerProfileAvailabilityLibrary() {
  return Object.freeze({
    id: POWER_PROFILE_AVAILABILITY_LIBRARY_ID,
    version: POWER_PROFILE_AVAILABILITY_LIBRARY_VERSION,
    merge: mergePowerProfileAvailabilityReports,
    plan: buildPowerProfileAvailabilityPlan,
    envelope: buildPowerProfileAvailabilityEnvelope
  });
}
