/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated capacity-evidence library. It validates, aggregates, and plans
 * capacity fact reports without importing the turbo or changing storage.
 */

export const STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_ID = 'storage-capacity.capacity-evidence.library';
export const STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['capacity-evidence-gap-sustained', 'capacity-evidence-gap-observed', 'complete-capacity-evidence', 'no-storage', 'incomplete-capacity-evidence', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireSampleCount(report, field, label) { if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) throw new RangeError(`Capacity-evidence library report ${label} must fit inside sampleCount`); return report[field]; }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Capacity-evidence library report must be an object');
  if (report.turbo !== 'storage-capacity.capacity-evidence') throw new Error('Capacity-evidence library requires a capacity-evidence turbo report');
  if (!STATES.includes(report.state)) throw new Error('Capacity-evidence library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Capacity-evidence library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Capacity-evidence library minimumSamples must be from 1 to 64');
  if (!Number.isFinite(report.evidenceThreshold) || report.evidenceThreshold < 0 || report.evidenceThreshold > 1) throw new RangeError('Capacity-evidence library evidenceThreshold must be between 0 and 1');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Capacity-evidence library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'], ['noStorageCount', 'no-storage count'], ['gapSampleCount', 'gap sample count']]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.storageCount) || report.storageCount < 0 || report.storageCount > 4096) throw new RangeError('Capacity-evidence library storageCount must be from 0 to 4096');
  for (const [field, label] of [['completeCount', 'complete count'], ['incompleteRowCount', 'incomplete row count']]) if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.storageCount) throw new RangeError(`Capacity-evidence library ${label} must fit inside storageCount`);
  if (report.evidenceRatio !== null && (!Number.isFinite(report.evidenceRatio) || report.evidenceRatio < 0 || report.evidenceRatio > 1)) throw new RangeError('Capacity-evidence library evidenceRatio must be null or between 0 and 1');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Capacity-evidence library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) { if (!Array.isArray(reports)) throw new TypeError('Capacity-evidence library reports must be an array'); if (reports.length > 64) throw new RangeError('Capacity-evidence library accepts at most 64 reports'); return Object.freeze(reports.map(requireReport)); }
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-storage')) return 'no-storage';
  if (reports.some((report) => report.state === 'incomplete-capacity-evidence')) return 'incomplete-capacity-evidence';
  if (reports.some((report) => report.state === 'capacity-evidence-gap-sustained')) return 'capacity-evidence-gap-sustained';
  if (reports.some((report) => report.state === 'capacity-evidence-gap-observed')) return 'capacity-evidence-gap-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'complete-capacity-evidence';
}
function mergedConfidence(reports) { if (reports.length === 0) return 0; const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0); if (samples === 0) return 0; return Math.round((reports.reduce((sum, report) => sum + report.observedCount, 0) / samples) * 10000) / 10000; }
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-capacity-facts']);
  if (state === 'no-storage') return Object.freeze(['no-storage-evidence-review']);
  if (state === 'incomplete-capacity-evidence') return Object.freeze(['request-environment-profile']);
  if (state === 'capacity-evidence-gap-sustained') return Object.freeze(['request-complete-capacity-facts']);
  if (state === 'capacity-evidence-gap-observed') return Object.freeze(['observe-capacity-fact-completeness']);
  return Object.freeze(['no-change']);
}
function environmentOf(environment) { return ENVIRONMENTS.includes(environment) ? environment : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'capacity-evidence-gap-sustained') return 'capacity-fact-review';
  if (state === 'capacity-evidence-gap-observed') return 'capacity-fact-observation';
  if (state === 'no-storage') return 'no-storage-observation';
  if (state === 'incomplete-capacity-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'complete-capacity-observation';
}
function intervalFor(state, environment) { if (state === 'capacity-evidence-gap-sustained') return 750; if (state === 'capacity-evidence-gap-observed') return 1000; if (state === 'no-storage') return 10000; if (state === 'incomplete-capacity-evidence' || state === 'insufficient-data') return 1500; return environment === 'headless' ? 10000 : 5000; }
function latest(reports) { return reports.at(-1) || { storageCount: 0, completeCount: 0, incompleteRowCount: 0, evidenceRatio: null }; }
export function mergeStorageCapacityCapacityEvidenceReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const last = latest(validated);
  return Object.freeze({ library: STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_ID, libraryVersion: STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0), storageCount: last.storageCount,
    completeCount: last.completeCount, incompleteRowCount: last.incompleteRowCount, evidenceRatio: last.evidenceRatio,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0), incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noStorageCount: validated.reduce((sum, report) => sum + report.noStorageCount, 0), gapSampleCount: validated.reduce((sum, report) => sum + report.gapSampleCount, 0),
    confidence: mergedConfidence(validated), recommendations: recommendations(state) });
}
export function buildStorageCapacityCapacityEvidencePlan(report, environment) { const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment); return Object.freeze({ library: STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_ID, environment: normalizedEnvironment, mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment), state: validated.state, confidence: validated.sampleCount === 0 ? 0 : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000 }); }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Capacity-evidence library clock must return a number'); return timestamp; }
export function buildStorageCapacityCapacityEvidenceEnvelope(report, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Capacity-evidence library trigger is required'); return Object.freeze({ library: STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_ID, libraryVersion: STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) }); }
export function createStorageCapacityCapacityEvidenceLibrary() { return Object.freeze({ id: STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_ID, version: STORAGE_CAPACITY_CAPACITY_EVIDENCE_LIBRARY_VERSION, merge: mergeStorageCapacityCapacityEvidenceReports, plan: buildStorageCapacityCapacityEvidencePlan, envelope: buildStorageCapacityCapacityEvidenceEnvelope }); }
