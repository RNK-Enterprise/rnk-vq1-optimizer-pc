/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated candidate-boundary library. It validates preview evidence and
 * builds review plans without reading paths or mutating files.
 */
export const TEMP_CANDIDATE_BOUNDARY_LIBRARY_ID = 'temp-cleanup.candidate-boundary.library';
export const TEMP_CANDIDATE_BOUNDARY_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['preview-stable', 'candidate-drift-observed', 'candidate-drift-sustained', 'review-required', 'no-temp-review', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Candidate-boundary library report must be an object');
  if (report.turbo !== 'temp-cleanup.candidate-boundary') throw new Error('Candidate-boundary library requires a candidate-boundary turbo report');
  if (!STATES.includes(report.state)) throw new Error('Candidate-boundary library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Candidate-boundary library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Candidate-boundary library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Candidate-boundary library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['fileCount', 'file count'], ['candidateCount', 'candidate count'], ['reviewCount', 'review count'], ['completeCount', 'complete count'], ['comparisonCount', 'comparison count'], ['changeCount', 'change count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Candidate-boundary library ${label} must be from 0 to 4096`);
  }
  if (!Number.isFinite(report.candidateBytes) || report.candidateBytes < 0) throw new RangeError('Candidate-boundary library candidateBytes must be non-negative');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Candidate-boundary library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Candidate-boundary library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Candidate-boundary library reports must be an array');
  if (reports.length > 64) throw new RangeError('Candidate-boundary library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'review-required')) return 'review-required';
  if (reports.some((report) => report.state === 'candidate-drift-sustained')) return 'candidate-drift-sustained';
  if (reports.some((report) => report.state === 'candidate-drift-observed')) return 'candidate-drift-observed';
  if (reports.every((report) => report.state === 'no-temp-review')) return 'no-temp-review';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'preview-stable';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-temp-candidate-samples']);
  if (state === 'no-temp-review') return Object.freeze(['no-temp-cleanup-review']);
  if (state === 'review-required') return Object.freeze(['review-temp-file-ownership']);
  if (state === 'candidate-drift-sustained') return Object.freeze(['review-candidate-drift-without-file-mutation']);
  if (state === 'candidate-drift-observed') return Object.freeze(['observe-temp-candidate-stability']);
  return Object.freeze(['preview-safe-temp-candidates']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'no-temp-review') return 'empty-observation';
  if (state === 'review-required') return 'ownership-review';
  if (state === 'candidate-drift-sustained') return 'candidate-review';
  if (state === 'candidate-drift-observed') return 'candidate-observation';
  if (state === 'insufficient-data') return 'evidence-bootstrap';
  return 'preview-observation';
}
function intervalFor(state, environment) {
  if (state === 'review-required') return 750;
  if (state === 'candidate-drift-sustained') return 1000;
  if (state === 'candidate-drift-observed') return 1500;
  if (state === 'no-temp-review') return 10000;
  if (state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeTempCandidateBoundaryReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: TEMP_CANDIDATE_BOUNDARY_LIBRARY_ID, libraryVersion: TEMP_CANDIDATE_BOUNDARY_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    fileCount: latest?.fileCount || 0, candidateCount: latest?.candidateCount || 0, reviewCount: latest?.reviewCount || 0,
    completeCount: latest?.completeCount || 0, candidateBytes: latest?.candidateBytes || 0,
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0), changeCount: validated.reduce((sum, report) => sum + report.changeCount, 0),
    finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildTempCandidateBoundaryPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: TEMP_CANDIDATE_BOUNDARY_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Candidate-boundary library clock must return a number'); return timestamp; }
export function buildTempCandidateBoundaryEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Candidate-boundary library trigger is required');
  return Object.freeze({ library: TEMP_CANDIDATE_BOUNDARY_LIBRARY_ID, libraryVersion: TEMP_CANDIDATE_BOUNDARY_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createTempCandidateBoundaryLibrary() {
  return Object.freeze({ id: TEMP_CANDIDATE_BOUNDARY_LIBRARY_ID, version: TEMP_CANDIDATE_BOUNDARY_LIBRARY_VERSION,
    merge: mergeTempCandidateBoundaryReports, plan: buildTempCandidateBoundaryPlan, envelope: buildTempCandidateBoundaryEnvelope });
}
