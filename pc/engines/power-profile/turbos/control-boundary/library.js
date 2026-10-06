/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated control-boundary library. It validates, aggregates, and plans
 * capability reports without importing a system-control API.
 */

export const POWER_PROFILE_CONTROL_LIBRARY_ID = 'power-profile.control-boundary.library';
export const POWER_PROFILE_CONTROL_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'stable-control', 'control-drift-observed', 'control-drift-sustained',
  'control-disabled', 'capability-unknown', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const CONTROL_STATES = Object.freeze(['enabled', 'disabled', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleBound(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Control library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireComparisonBound(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.comparisonCount) {
    throw new RangeError(`Control library report ${label} must fit inside comparisonCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Control library report must be an object');
  if (report.turbo !== 'power-profile.control-boundary') {
    throw new Error('Control library requires a control-boundary turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Control library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Control library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Control library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Control library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['unknownCount', 'unknown count'],
    ['enabledCount', 'enabled count'], ['disabledCount', 'disabled count']
  ]) requireSampleBound(report, field, label);
  if (!Number.isInteger(report.comparisonCount) || report.comparisonCount < 0
    || report.comparisonCount > Math.max(0, report.sampleCount - 1)) {
    throw new RangeError('Control library comparisonCount must fit inside the sample window');
  }
  for (const [field, label] of [['controlChangeCount', 'control-change count']]) {
    requireComparisonBound(report, field, label);
  }
  for (const [field, label] of [
    ['enabledToDisabledCount', 'enabled-to-disabled count'],
    ['disabledToEnabledCount', 'disabled-to-enabled count']
  ]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.controlChangeCount) {
      throw new RangeError(`Control library ${label} must fit inside controlChangeCount`);
    }
  }
  if (!CONTROL_STATES.includes(report.finalControl)) {
    throw new TypeError('Control library finalControl must be enabled, disabled, or unknown');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Control library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Control library reports must be an array');
  if (reports.length > 64) throw new RangeError('Control library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'control-drift-sustained')) return 'control-drift-sustained';
  if (reports.some((report) => report.state === 'control-drift-observed')) return 'control-drift-observed';
  if (reports.some((report) => report.state === 'control-disabled')) return 'control-disabled';
  if (reports.every((report) => report.state === 'capability-unknown')) return 'capability-unknown';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-control';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-control-samples']);
  if (state === 'capability-unknown') return Object.freeze(['request-explicit-power-profile-capability']);
  if (state === 'control-disabled') return Object.freeze(['preserve-disabled-power-profile-control']);
  if (state === 'control-drift-sustained') return Object.freeze(['review-power-profile-capability-drift']);
  if (state === 'control-drift-observed') return Object.freeze(['observe-power-profile-capability-stability']);
  return Object.freeze(['no-change']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'control-drift-sustained') return 'capability-review';
  if (state === 'control-drift-observed') return 'capability-observation';
  if (state === 'control-disabled') return 'disabled-preservation';
  if (state === 'capability-unknown') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-observation';
}

function intervalFor(state, environment) {
  if (state === 'control-drift-sustained') return 750;
  if (state === 'control-drift-observed') return 1000;
  if (state === 'control-disabled') return 10000;
  if (state === 'capability-unknown' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}

export function mergePowerProfileControlReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const latest = validated.at(-1);
  return Object.freeze({
    library: POWER_PROFILE_CONTROL_LIBRARY_ID,
    libraryVersion: POWER_PROFILE_CONTROL_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    unknownCount: validated.reduce((sum, report) => sum + report.unknownCount, 0),
    enabledCount: validated.reduce((sum, report) => sum + report.enabledCount, 0),
    disabledCount: validated.reduce((sum, report) => sum + report.disabledCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    controlChangeCount: validated.reduce((sum, report) => sum + report.controlChangeCount, 0),
    enabledToDisabledCount: validated.reduce((sum, report) => sum + report.enabledToDisabledCount, 0),
    disabledToEnabledCount: validated.reduce((sum, report) => sum + report.disabledToEnabledCount, 0),
    finalControl: latest?.finalControl || 'unknown',
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildPowerProfileControlPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: POWER_PROFILE_CONTROL_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Control library clock must return a number');
  return timestamp;
}

export function buildPowerProfileControlEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Control library trigger is required');
  }
  return Object.freeze({
    library: POWER_PROFILE_CONTROL_LIBRARY_ID,
    libraryVersion: POWER_PROFILE_CONTROL_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createPowerProfileControlLibrary() {
  return Object.freeze({
    id: POWER_PROFILE_CONTROL_LIBRARY_ID,
    version: POWER_PROFILE_CONTROL_LIBRARY_VERSION,
    merge: mergePowerProfileControlReports,
    plan: buildPowerProfileControlPlan,
    envelope: buildPowerProfileControlEnvelope
  });
}
