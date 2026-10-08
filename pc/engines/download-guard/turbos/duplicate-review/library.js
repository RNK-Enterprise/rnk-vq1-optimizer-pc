/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Duplicate-review library for aggregating non-destructive duplicate evidence.
 */

export const DOWNLOAD_GUARD_DUPLICATE_REVIEW_LIBRARY_ID = 'download-guard.duplicate-review.library';
export const DOWNLOAD_GUARD_DUPLICATE_REVIEW_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['duplicates-found', 'hash-review', 'no-duplicates', 'insufficient-data']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) { if (!isRecord(report)) throw new TypeError('Duplicate-review library report must be an object'); if (report.turbo !== 'download-guard.duplicate-review') throw new Error('Duplicate-review library requires a duplicate-review turbo report'); if (!STATES.includes(report.state)) throw new Error('Duplicate-review library report has an invalid state'); if (!Number.isInteger(report.duplicateCount) || report.duplicateCount < 0) throw new RangeError('Duplicate-review library duplicateCount must be non-negative'); return report; }
function requireReports(reports) { if (!Array.isArray(reports)) throw new TypeError('Duplicate-review library reports must be an array'); if (reports.length > 64) throw new RangeError('Duplicate-review library accepts at most 64 reports'); return Object.freeze(reports.map(requireReport)); }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Duplicate-review library clock must return a number'); return timestamp; }
export function mergeDownloadGuardDuplicateReviewReports(reports) { const validated = requireReports(reports); const state = validated.some((report) => report.state === 'duplicates-found') ? 'duplicates-found' : validated.some((report) => report.state === 'hash-review') ? 'hash-review' : validated.some((report) => report.state === 'no-duplicates') ? 'no-duplicates' : 'insufficient-data'; return Object.freeze({ library: DOWNLOAD_GUARD_DUPLICATE_REVIEW_LIBRARY_ID, libraryVersion: DOWNLOAD_GUARD_DUPLICATE_REVIEW_LIBRARY_VERSION, reportCount: validated.length, state, duplicateCount: validated.reduce((sum, report) => sum + report.duplicateCount, 0) }); }
export function buildDownloadGuardDuplicateReviewPlan(report, environment = 'unknown') { const validated = requireReport(report); const normalized = ['interactive', 'headless'].includes(environment) ? environment : 'unknown'; return Object.freeze({ library: DOWNLOAD_GUARD_DUPLICATE_REVIEW_LIBRARY_ID, environment: normalized, mode: normalized === 'unknown' ? 'profile-required' : validated.state === 'duplicates-found' ? 'duplicate-review' : 'observation-only' }); }
export function buildDownloadGuardDuplicateReviewEnvelope(report, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || !trigger) throw new TypeError('Duplicate-review library trigger is required'); return Object.freeze({ library: DOWNLOAD_GUARD_DUPLICATE_REVIEW_LIBRARY_ID, libraryVersion: DOWNLOAD_GUARD_DUPLICATE_REVIEW_LIBRARY_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) }); }
export function createDownloadGuardDuplicateReviewLibrary() { return Object.freeze({ id: DOWNLOAD_GUARD_DUPLICATE_REVIEW_LIBRARY_ID, version: DOWNLOAD_GUARD_DUPLICATE_REVIEW_LIBRARY_VERSION, merge: mergeDownloadGuardDuplicateReviewReports, plan: buildDownloadGuardDuplicateReviewPlan, envelope: buildDownloadGuardDuplicateReviewEnvelope }); }
