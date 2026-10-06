/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated preview-safety library. It validates conservative preview
 * evidence and builds review plans without reading paths or mutating files.
 */
export const TEMP_PREVIEW_SAFETY_LIBRARY_ID = 'temp-cleanup.preview-safety.library';
export const TEMP_PREVIEW_SAFETY_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['preview-safe-stable', 'preview-drift-observed', 'preview-drift-sustained', 'safety-evidence-required', 'user-owned-review', 'no-temp-review', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Preview-safety library report must be an object');
  if (report.turbo !== 'temp-cleanup.preview-safety') throw new Error('Preview-safety library requires a preview-safety turbo report');
  if (!STATES.includes(report.state)) throw new Error('Preview-safety library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Preview-safety library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Preview-safety library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Preview-safety library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['fileCount', 'file count'], ['safeCount', 'safe count'], ['reviewCount', 'review count'], ['userOwnedCount', 'user-owned count'], ['incompleteCount', 'incomplete count'], ['comparisonCount', 'comparison count'], ['changeCount', 'change count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Preview-safety library ${label} must be from 0 to 4096`);
  }
  if (!Number.isFinite(report.candidateBytes) || report.candidateBytes < 0) throw new RangeError('Preview-safety library candidateBytes must be non-negative');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Preview-safety library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Preview-safety library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Preview-safety library reports must be an array');
  if (reports.length > 64) throw new RangeError('Preview-safety library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'user-owned-review')) return 'user-owned-review';
  if (reports.some((report) => report.state === 'safety-evidence-required')) return 'safety-evidence-required';
  if (reports.some((report) => report.state === 'preview-drift-sustained')) return 'preview-drift-sustained';
  if (reports.some((report) => report.state === 'preview-drift-observed')) return 'preview-drift-observed';
  if (reports.every((report) => report.state === 'no-temp-review')) return 'no-temp-review';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'preview-safe-stable';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-temp-preview-evidence']);
  if (state === 'no-temp-review') return Object.freeze(['no-temp-cleanup-review']);
  if (state === 'user-owned-review') return Object.freeze(['preserve-user-owned-temp-boundary']);
  if (state === 'safety-evidence-required') return Object.freeze(['complete-temp-preview-evidence']);
  if (state === 'preview-drift-sustained') return Object.freeze(['review-temp-preview-drift-without-mutation']);
  if (state === 'preview-drift-observed') return Object.freeze(['observe-temp-preview-stability']);
  return Object.freeze(['preview-safe-temp-candidates']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'no-temp-review') return 'empty-observation';
  if (state === 'user-owned-review') return 'user-owned-review';
  if (state === 'safety-evidence-required') return 'evidence-review';
  if (state === 'preview-drift-sustained') return 'preview-drift-review';
  if (state === 'preview-drift-observed') return 'preview-drift-observation';
  if (state === 'insufficient-data') return 'evidence-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'user-owned-review') return 750;
  if (state === 'safety-evidence-required') return 1000;
  if (state === 'preview-drift-sustained') return 1250;
  if (state === 'preview-drift-observed') return 1500;
  if (state === 'no-temp-review') return 10000;
  if (state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeTempPreviewSafetyReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: TEMP_PREVIEW_SAFETY_LIBRARY_ID, libraryVersion: TEMP_PREVIEW_SAFETY_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    fileCount: latest?.fileCount || 0, safeCount: latest?.safeCount || 0, reviewCount: latest?.reviewCount || 0,
    userOwnedCount: latest?.userOwnedCount || 0, incompleteCount: latest?.incompleteCount || 0,
    candidateBytes: latest?.candidateBytes || 0, comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0), finalEnvironment: latest?.finalEnvironment || 'unknown',
    confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildTempPreviewSafetyPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: TEMP_PREVIEW_SAFETY_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Preview-safety library clock must return a number'); return timestamp; }
export function buildTempPreviewSafetyEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Preview-safety library trigger is required');
  return Object.freeze({ library: TEMP_PREVIEW_SAFETY_LIBRARY_ID, libraryVersion: TEMP_PREVIEW_SAFETY_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createTempPreviewSafetyLibrary() {
  return Object.freeze({ id: TEMP_PREVIEW_SAFETY_LIBRARY_ID, version: TEMP_PREVIEW_SAFETY_LIBRARY_VERSION,
    merge: mergeTempPreviewSafetyReports, plan: buildTempPreviewSafetyPlan, envelope: buildTempPreviewSafetyEnvelope });
}
