/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated size-trend library. It validates preview-size evidence and builds
 * review plans without reading paths or mutating files.
 */
export const TEMP_SIZE_TREND_LIBRARY_ID = 'temp-cleanup.size-trend.library';
export const TEMP_SIZE_TREND_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['stable-size', 'size-shrink-observed', 'size-growth-observed', 'size-growth-sustained', 'size-observation-required', 'review-required', 'no-temp-review', 'insufficient-data']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Size-trend library report must be an object');
  if (report.turbo !== 'temp-cleanup.size-trend') throw new Error('Size-trend library requires a size-trend turbo report');
  if (!STATES.includes(report.state)) throw new Error('Size-trend library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) throw new RangeError('Size-trend library report sampleCount must be from 0 to 64');
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) throw new RangeError('Size-trend library minimumSamples must be from 1 to 64');
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1 || report.persistenceThreshold > 64) throw new RangeError('Size-trend library persistenceThreshold must be from 1 to 64');
  for (const [field, label] of [['fileCount', 'file count'], ['candidateCount', 'candidate count'], ['reviewCount', 'review count'], ['sizedCount', 'sized count'], ['unknownSizeCount', 'unknown-size count'], ['comparisonCount', 'comparison count'], ['growthCount', 'growth count'], ['shrinkCount', 'shrink count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > 4096) throw new RangeError(`Size-trend library ${label} must be from 0 to 4096`);
  }
  if (!Number.isFinite(report.finalCandidateBytes) || report.finalCandidateBytes < 0) throw new RangeError('Size-trend library finalCandidateBytes must be non-negative');
  if (!ENVIRONMENTS.includes(report.finalEnvironment)) throw new TypeError('Size-trend library finalEnvironment must be normalized');
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) throw new RangeError('Size-trend library confidence must be between 0 and 1');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Size-trend library reports must be an array');
  if (reports.length > 64) throw new RangeError('Size-trend library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'review-required')) return 'review-required';
  if (reports.some((report) => report.state === 'size-growth-sustained')) return 'size-growth-sustained';
  if (reports.some((report) => report.state === 'size-growth-observed')) return 'size-growth-observed';
  if (reports.some((report) => report.state === 'size-shrink-observed')) return 'size-shrink-observed';
  if (reports.some((report) => report.state === 'size-observation-required')) return 'size-observation-required';
  if (reports.every((report) => report.state === 'no-temp-review')) return 'no-temp-review';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-size';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-temp-size-samples']);
  if (state === 'no-temp-review') return Object.freeze(['no-temp-cleanup-review']);
  if (state === 'review-required') return Object.freeze(['review-temp-file-ownership']);
  if (state === 'size-observation-required') return Object.freeze(['request-temp-size-observation']);
  if (state === 'size-growth-sustained') return Object.freeze(['review-temp-growth-without-file-mutation']);
  if (state === 'size-growth-observed') return Object.freeze(['observe-temp-size-stability']);
  if (state === 'size-shrink-observed') return Object.freeze(['record-temp-size-shrinkage']);
  return Object.freeze(['no-change']);
}
function environmentOf(value) { return ENVIRONMENTS.includes(value) ? value : 'unknown'; }
function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'no-temp-review') return 'empty-observation';
  if (state === 'review-required') return 'ownership-review';
  if (state === 'size-growth-sustained') return 'size-review';
  if (state === 'size-growth-observed') return 'size-observation';
  if (state === 'size-shrink-observed') return 'shrink-review';
  if (state === 'size-observation-required' || state === 'insufficient-data') return 'evidence-bootstrap';
  return 'stable-observation';
}
function intervalFor(state, environment) {
  if (state === 'review-required') return 750;
  if (state === 'size-growth-sustained') return 1000;
  if (state === 'size-growth-observed' || state === 'size-shrink-observed') return 1500;
  if (state === 'no-temp-review') return 10000;
  if (state === 'size-observation-required' || state === 'insufficient-data') return 2000;
  return environment === 'headless' ? 10000 : 5000;
}
export function mergeTempSizeTrendReports(reports) {
  const validated = requireReports(reports); const state = mergedState(validated); const latest = validated.at(-1);
  return Object.freeze({ library: TEMP_SIZE_TREND_LIBRARY_ID, libraryVersion: TEMP_SIZE_TREND_LIBRARY_VERSION,
    reportCount: validated.length, state, sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    fileCount: latest?.fileCount || 0, candidateCount: latest?.candidateCount || 0, reviewCount: latest?.reviewCount || 0,
    sizedCount: latest?.sizedCount || 0, unknownSizeCount: latest?.unknownSizeCount || 0, comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    growthCount: validated.reduce((sum, report) => sum + report.growthCount, 0), shrinkCount: validated.reduce((sum, report) => sum + report.shrinkCount, 0),
    finalCandidateBytes: latest?.finalCandidateBytes || 0, finalEnvironment: latest?.finalEnvironment || 'unknown', confidence: latest?.confidence || 0, recommendations: recommendations(state) });
}
export function buildTempSizeTrendPlan(report, environment) {
  const validated = requireReport(report); const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({ library: TEMP_SIZE_TREND_LIBRARY_ID, environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment), intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state, confidence: validated.sampleCount === 0 ? 0 : validated.confidence });
}
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Size-trend library clock must return a number'); return timestamp; }
export function buildTempSizeTrendEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) throw new TypeError('Size-trend library trigger is required');
  return Object.freeze({ library: TEMP_SIZE_TREND_LIBRARY_ID, libraryVersion: TEMP_SIZE_TREND_LIBRARY_VERSION,
    trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}
export function createTempSizeTrendLibrary() {
  return Object.freeze({ id: TEMP_SIZE_TREND_LIBRARY_ID, version: TEMP_SIZE_TREND_LIBRARY_VERSION,
    merge: mergeTempSizeTrendReports, plan: buildTempSizeTrendPlan, envelope: buildTempSizeTrendEnvelope });
}
