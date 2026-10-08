/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated free-space-drift library. It validates, aggregates, and plans
 * headroom reports without importing the turbo or changing storage.
 */

export const STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_ID = 'storage-capacity.free-space-drift.library';
export const STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'headroom-pressure-sustained', 'headroom-pressure-observed', 'stable-headroom',
  'no-storage', 'incomplete-headroom-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Free-space-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Free-space-drift library report must be an object');
  if (report.turbo !== 'storage-capacity.free-space-drift') throw new Error('Free-space-drift library requires a free-space-drift turbo report');
  if (!STATES.includes(report.state)) throw new Error('Free-space-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Free-space-drift library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Free-space-drift library minimumSamples must be from 1 to 64');
  }
  if (!Number.isFinite(report.headroomThreshold) || report.headroomThreshold < 0 || report.headroomThreshold > 100) {
    throw new RangeError('Free-space-drift library headroomThreshold must be between 0 and 100');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) {
    throw new RangeError('Free-space-drift library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noStorageCount', 'no-storage count'], ['pressureSampleCount', 'pressure sample count']]) {
    requireSampleCount(report, field, label);
  }
  if (!Number.isInteger(report.storageCount) || report.storageCount < 0 || report.storageCount > 4096) {
    throw new RangeError('Free-space-drift library storageCount must be from 0 to 4096');
  }
  if (report.minimumFreePercent !== null
    && (!Number.isFinite(report.minimumFreePercent) || report.minimumFreePercent < 0 || report.minimumFreePercent > 100)) {
    throw new RangeError('Free-space-drift library minimumFreePercent must be null or from 0 to 100');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Free-space-drift library confidence must be between 0 and 1');
  }
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Free-space-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Free-space-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-storage')) return 'no-storage';
  if (reports.some((report) => report.state === 'incomplete-headroom-evidence')) return 'incomplete-headroom-evidence';
  if (reports.some((report) => report.state === 'headroom-pressure-sustained')) return 'headroom-pressure-sustained';
  if (reports.some((report) => report.state === 'headroom-pressure-observed')) return 'headroom-pressure-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-headroom';
}
function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-headroom-samples']);
  if (state === 'no-storage') return Object.freeze(['no-storage-headroom-review']);
  if (state === 'incomplete-headroom-evidence') return Object.freeze(['request-headroom-observation']);
  if (state === 'headroom-pressure-sustained') return Object.freeze(['review-free-space', 'hold-automatic-cleanup']);
  if (state === 'headroom-pressure-observed') return Object.freeze(['observe-next-headroom-sample']);
  return Object.freeze(['no-change']);
}
function environmentOf(environment) { return ENVIRONMENTS.includes(environment) ? environment : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'headroom-pressure-sustained') return 'headroom-pressure-review';
  if (state === 'headroom-pressure-observed') return 'headroom-pressure-observation';
  if (state === 'no-storage') return 'no-storage-observation';
  if (state === 'incomplete-headroom-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-headroom-observation';
}
function intervalFor(state, environment) {
  if (state === 'headroom-pressure-sustained') return 750;
  if (state === 'headroom-pressure-observed') return 1000;
  if (state === 'no-storage') return 10000;
  if (state === 'incomplete-headroom-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}
function latest(reports) {
  const report = reports.at(-1);
  return report || { storageCount: 0, minimumFreePercent: null };
}
export function mergeStorageCapacityFreeSpaceDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_ID,
    libraryVersion: STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length, state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    storageCount: last.storageCount, minimumFreePercent: last.minimumFreePercent,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noStorageCount: validated.reduce((sum, report) => sum + report.noStorageCount, 0),
    pressureSampleCount: validated.reduce((sum, report) => sum + report.pressureSampleCount, 0),
    confidence: mergedConfidence(validated), recommendations: recommendations(state)
  });
}
export function buildStorageCapacityFreeSpaceDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0 ? 0 : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}
function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Free-space-drift library clock must return a number');
  return timestamp;
}
export function buildStorageCapacityFreeSpaceDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Free-space-drift library trigger is required');
  return Object.freeze({ library: STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_ID,
    libraryVersion: STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_VERSION, trigger,
    generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createStorageCapacityFreeSpaceDriftLibrary() {
  return Object.freeze({ id: STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_ID,
    version: STORAGE_CAPACITY_FREE_SPACE_DRIFT_LIBRARY_VERSION,
    merge: mergeStorageCapacityFreeSpaceDriftReports, plan: buildStorageCapacityFreeSpaceDriftPlan,
    envelope: buildStorageCapacityFreeSpaceDriftEnvelope });
}
