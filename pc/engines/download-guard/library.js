/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Download-guard library. It merges preflight reports and exposes a review
 * plan while keeping all file and download mutation behind approval.
 */

export const DOWNLOAD_GUARD_LIBRARY_ID = 'download-guard-library';
export const DOWNLOAD_GUARD_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['allow', 'redirect', 'insufficient-space', 'duplicate-review', 'incomplete-review', 'protected-target', 'storage-safety-review', 'observation-required']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) { if (!isRecord(report)) throw new TypeError('Download-guard library report must be an object'); if (report.engine !== 'download-guard') throw new Error('Download-guard library requires a download-guard report'); if (!STATES.includes(report.state)) throw new Error('Download-guard library report has an invalid state'); if (!Array.isArray(report.recommendations) || !Array.isArray(report.actions)) throw new TypeError('Download-guard library report requires recommendations and actions'); return report; }
function requireReports(reports) { if (!Array.isArray(reports)) throw new TypeError('Download-guard library reports must be an array'); if (reports.length > 64) throw new RangeError('Download-guard library accepts at most 64 reports'); return Object.freeze(reports.map(requireReport)); }
function priority(state) { return { 'storage-safety-review': 8, 'protected-target': 7, 'observation-required': 6, 'insufficient-space': 5, 'duplicate-review': 4, 'incomplete-review': 3, redirect: 2, allow: 1 }[state]; }
function requireEnvironment(value) { return ['interactive', 'headless', 'unknown'].includes(value) ? value : 'unknown'; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Download-guard library clock must return a number'); return timestamp; }
export function mergeDownloadGuardReports(reports) { const validated = requireReports(reports); const latest = validated.at(-1) || null; const state = validated.reduce((winner, report) => priority(report.state) > priority(winner) ? report.state : winner, 'allow'); return Object.freeze({ library: DOWNLOAD_GUARD_LIBRARY_ID, libraryVersion: DOWNLOAD_GUARD_LIBRARY_VERSION, reportCount: validated.length, state: validated.length ? state : 'observation-required', targetMount: latest?.targetMount || null, recoveredBytes: 0, recommendations: Object.freeze([...new Set(validated.flatMap((report) => report.recommendations))]) }); }
export function buildDownloadGuardPlan(report, environment = 'unknown') { const validated = requireReport(report); const normalized = requireEnvironment(environment); return Object.freeze({ library: DOWNLOAD_GUARD_LIBRARY_ID, environment: normalized, mode: normalized === 'unknown' ? 'profile-required' : validated.state === 'allow' ? 'approval-ready' : 'review-required', targetMount: validated.targetMount, actions: Object.freeze([]) }); }
export function buildDownloadGuardEnvelope(report, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || !trigger) throw new TypeError('Download-guard library trigger is required'); return Object.freeze({ library: DOWNLOAD_GUARD_LIBRARY_ID, libraryVersion: DOWNLOAD_GUARD_LIBRARY_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) }); }
export function createDownloadGuardLibrary() { return Object.freeze({ id: DOWNLOAD_GUARD_LIBRARY_ID, version: DOWNLOAD_GUARD_LIBRARY_VERSION, merge: mergeDownloadGuardReports, plan: buildDownloadGuardPlan, envelope: buildDownloadGuardEnvelope }); }
