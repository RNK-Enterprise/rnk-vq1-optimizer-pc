/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Space-preflight library for merging storage headroom evidence.
 */

export const DOWNLOAD_GUARD_SPACE_PREFLIGHT_LIBRARY_ID = 'download-guard.space-preflight.library';
export const DOWNLOAD_GUARD_SPACE_PREFLIGHT_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['enough-space', 'space-shortfall', 'storage-safety-review', 'observation-required']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) { if (!isRecord(report)) throw new TypeError('Space-preflight library report must be an object'); if (report.turbo !== 'download-guard.space-preflight') throw new Error('Space-preflight library requires a space-preflight turbo report'); if (!STATES.includes(report.state)) throw new Error('Space-preflight library report has an invalid state'); if (!Array.isArray(report.eligibleMounts)) throw new TypeError('Space-preflight library report requires eligibleMounts'); return report; }
function requireReports(reports) { if (!Array.isArray(reports)) throw new TypeError('Space-preflight library reports must be an array'); if (reports.length > 64) throw new RangeError('Space-preflight library accepts at most 64 reports'); return Object.freeze(reports.map(requireReport)); }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Space-preflight library clock must return a number'); return timestamp; }
export function mergeDownloadGuardSpacePreflightReports(reports) { const validated = requireReports(reports); const state = validated.some((report) => report.state === 'storage-safety-review') ? 'storage-safety-review' : validated.some((report) => report.state === 'space-shortfall') ? 'space-shortfall' : validated.some((report) => report.state === 'enough-space') ? 'enough-space' : 'observation-required'; return Object.freeze({ library: DOWNLOAD_GUARD_SPACE_PREFLIGHT_LIBRARY_ID, libraryVersion: DOWNLOAD_GUARD_SPACE_PREFLIGHT_LIBRARY_VERSION, reportCount: validated.length, state, eligibleMounts: Object.freeze([...new Set(validated.flatMap((report) => report.eligibleMounts))]) }); }
export function buildDownloadGuardSpacePreflightPlan(report, environment = 'unknown') { const validated = requireReport(report); const normalized = ['interactive', 'headless'].includes(environment) ? environment : 'unknown'; return Object.freeze({ library: DOWNLOAD_GUARD_SPACE_PREFLIGHT_LIBRARY_ID, environment: normalized, mode: normalized === 'unknown' ? 'profile-required' : validated.state === 'enough-space' ? 'download-review' : 'storage-review' }); }
export function buildDownloadGuardSpacePreflightEnvelope(report, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || !trigger) throw new TypeError('Space-preflight library trigger is required'); return Object.freeze({ library: DOWNLOAD_GUARD_SPACE_PREFLIGHT_LIBRARY_ID, libraryVersion: DOWNLOAD_GUARD_SPACE_PREFLIGHT_LIBRARY_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) }); }
export function createDownloadGuardSpacePreflightLibrary() { return Object.freeze({ id: DOWNLOAD_GUARD_SPACE_PREFLIGHT_LIBRARY_ID, version: DOWNLOAD_GUARD_SPACE_PREFLIGHT_LIBRARY_VERSION, merge: mergeDownloadGuardSpacePreflightReports, plan: buildDownloadGuardSpacePreflightPlan, envelope: buildDownloadGuardSpacePreflightEnvelope }); }
