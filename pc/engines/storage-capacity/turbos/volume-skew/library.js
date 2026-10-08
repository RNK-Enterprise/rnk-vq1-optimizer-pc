/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated volume-skew library. It validates, aggregates, and plans
 * volume headroom reports without importing the turbo or changing storage.
 */

export const STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_ID = 'storage-capacity.volume-skew.library';
export const STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['volume-skew-sustained', 'volume-skew-observed', 'balanced-volumes', 'no-storage', 'incomplete-skew-evidence', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) throw new RangeError(`Volume-skew library report ${label} must fit inside sampleCount`);
  return report[field];
}
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Volume-skew library report must be an object');
  if (report.turbo !== 'storage-capacity.volume-skew') throw new Error('Volume-skew library requires a volume-skew turbo report');
  if (!STATES.includes(report.state)) throw new Error('Volume-skew library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Volume-skew library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Volume-skew library minimumSamples must be from 1 to 64');
  if (!Number.isFinite(report.skewThreshold) || report.skewThreshold < 0 || report.skewThreshold > 100) throw new RangeError('Volume-skew library skewThreshold must be between 0 and 100');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Volume-skew library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'], ['noStorageCount', 'no-storage count'], ['skewSampleCount', 'skew sample count']]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.storageCount) || report.storageCount < 0 || report.storageCount > 4096) throw new RangeError('Volume-skew library storageCount must be from 0 to 4096');
  if (report.skewPercent !== null && (!Number.isFinite(report.skewPercent) || report.skewPercent < 0 || report.skewPercent > 100)) throw new RangeError('Volume-skew library skewPercent must be null or from 0 to 100');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Volume-skew library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Volume-skew library reports must be an array');
  if (reports.length > 64) throw new RangeError('Volume-skew library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-storage')) return 'no-storage';
  if (reports.some((report) => report.state === 'incomplete-skew-evidence')) return 'incomplete-skew-evidence';
  if (reports.some((report) => report.state === 'volume-skew-sustained')) return 'volume-skew-sustained';
  if (reports.some((report) => report.state === 'volume-skew-observed')) return 'volume-skew-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'balanced-volumes';
}
function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  return Math.round((reports.reduce((sum, report) => sum + report.observedCount, 0) / samples) * 10000) / 10000;
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-volume-samples']);
  if (state === 'no-storage') return Object.freeze(['no-storage-skew-review']);
  if (state === 'incomplete-skew-evidence') return Object.freeze(['request-volume-observation']);
  if (state === 'volume-skew-sustained') return Object.freeze(['review-volume-headroom', 'hold-automatic-rebalancing']);
  if (state === 'volume-skew-observed') return Object.freeze(['observe-volume-headroom']);
  return Object.freeze(['no-change']);
}
function environmentOf(environment) { return ENVIRONMENTS.includes(environment) ? environment : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'volume-skew-sustained') return 'volume-skew-review';
  if (state === 'volume-skew-observed') return 'volume-skew-observation';
  if (state === 'no-storage') return 'no-storage-observation';
  if (state === 'incomplete-skew-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'balanced-volume-observation';
}
function intervalFor(state, environment) {
  if (state === 'volume-skew-sustained') return 750;
  if (state === 'volume-skew-observed') return 1000;
  if (state === 'no-storage') return 10000;
  if (state === 'incomplete-skew-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}
function latest(reports) { return reports.at(-1) || { storageCount: 0, skewPercent: null }; }
export function mergeStorageCapacityVolumeSkewReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const last = latest(validated);
  return Object.freeze({ library: STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_ID, libraryVersion: STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    storageCount: last.storageCount, skewPercent: last.skewPercent,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noStorageCount: validated.reduce((sum, report) => sum + report.noStorageCount, 0),
    skewSampleCount: validated.reduce((sum, report) => sum + report.skewSampleCount, 0),
    confidence: mergedConfidence(validated), recommendations: recommendations(state) });
}
export function buildStorageCapacityVolumeSkewPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment), state: validated.state,
    confidence: validated.sampleCount === 0 ? 0 : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000 });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Volume-skew library clock must return a number'); return timestamp; }
export function buildStorageCapacityVolumeSkewEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Volume-skew library trigger is required');
  return Object.freeze({ library: STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_ID, libraryVersion: STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createStorageCapacityVolumeSkewLibrary() {
  return Object.freeze({ id: STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_ID, version: STORAGE_CAPACITY_VOLUME_SKEW_LIBRARY_VERSION,
    merge: mergeStorageCapacityVolumeSkewReports, plan: buildStorageCapacityVolumeSkewPlan, envelope: buildStorageCapacityVolumeSkewEnvelope });
}
