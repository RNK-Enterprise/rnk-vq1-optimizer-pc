/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Hash-verification library for merging integrity evidence.
 */

export const DOWNLOAD_GUARD_HASH_VERIFICATION_LIBRARY_ID = 'download-guard.hash-verification.library';
export const DOWNLOAD_GUARD_HASH_VERIFICATION_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['verified', 'mismatch', 'unavailable', 'insufficient-data']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) { if (!isRecord(report)) throw new TypeError('Hash-verification library report must be an object'); if (report.turbo !== 'download-guard.hash-verification') throw new Error('Hash-verification library requires a hash-verification turbo report'); if (!STATES.includes(report.state)) throw new Error('Hash-verification library report has an invalid state'); if (!Number.isInteger(report.mismatchCount) || report.mismatchCount < 0) throw new RangeError('Hash-verification library mismatchCount must be non-negative'); return report; }
function requireReports(reports) { if (!Array.isArray(reports)) throw new TypeError('Hash-verification library reports must be an array'); if (reports.length > 64) throw new RangeError('Hash-verification library accepts at most 64 reports'); return Object.freeze(reports.map(requireReport)); }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Hash-verification library clock must return a number'); return timestamp; }
export function mergeDownloadGuardHashVerificationReports(reports) { const validated = requireReports(reports); const state = validated.some((report) => report.state === 'mismatch') ? 'mismatch' : validated.some((report) => report.state === 'verified') ? 'verified' : validated.some((report) => report.state === 'unavailable') ? 'unavailable' : 'insufficient-data'; return Object.freeze({ library: DOWNLOAD_GUARD_HASH_VERIFICATION_LIBRARY_ID, libraryVersion: DOWNLOAD_GUARD_HASH_VERIFICATION_LIBRARY_VERSION, reportCount: validated.length, state, mismatchCount: validated.reduce((sum, report) => sum + report.mismatchCount, 0) }); }
export function buildDownloadGuardHashVerificationPlan(report, environment = 'unknown') { const validated = requireReport(report); const normalized = ['interactive', 'headless'].includes(environment) ? environment : 'unknown'; return Object.freeze({ library: DOWNLOAD_GUARD_HASH_VERIFICATION_LIBRARY_ID, environment: normalized, mode: normalized === 'unknown' ? 'profile-required' : validated.state === 'mismatch' ? 'refuse-download' : 'integrity-review' }); }
export function buildDownloadGuardHashVerificationEnvelope(report, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || !trigger) throw new TypeError('Hash-verification library trigger is required'); return Object.freeze({ library: DOWNLOAD_GUARD_HASH_VERIFICATION_LIBRARY_ID, libraryVersion: DOWNLOAD_GUARD_HASH_VERIFICATION_LIBRARY_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) }); }
export function createDownloadGuardHashVerificationLibrary() { return Object.freeze({ id: DOWNLOAD_GUARD_HASH_VERIFICATION_LIBRARY_ID, version: DOWNLOAD_GUARD_HASH_VERIFICATION_LIBRARY_VERSION, merge: mergeDownloadGuardHashVerificationReports, plan: buildDownloadGuardHashVerificationPlan, envelope: buildDownloadGuardHashVerificationEnvelope }); }
