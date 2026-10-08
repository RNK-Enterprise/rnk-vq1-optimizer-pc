/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 * History-report turbo library.
 */

export const WORKSTATION_STEWARD_HISTORY_REPORT_LIBRARY_ID = 'workstation-steward.history-report.library';
export const WORKSTATION_STEWARD_HISTORY_REPORT_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['insufficient-data', 'observation-required', 'report-ready']);
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function report(value) { if (!record(value)) throw new TypeError('History-report library report must be an object'); if (value.turbo !== 'workstation-steward.history-report') throw new Error('History-report library requires a history-report report'); if (!STATES.includes(value.state)) throw new Error('History-report library report has an invalid state'); if (!record(value.report)) throw new TypeError('History-report library report requires a daily report'); return value; }
function reports(values) { if (!Array.isArray(values)) throw new TypeError('History-report library reports must be an array'); if (values.length > 64) throw new RangeError('History-report library accepts at most 64 reports'); return values.map(report); }
function clock(now) { const value = now(); if (!Number.isFinite(value)) throw new TypeError('History-report library clock must return a number'); return value; }
export function mergeWorkstationStewardHistoryReportReports(values) { const checked = reports(values); const latest = checked.at(-1) || null; return Object.freeze({ library: WORKSTATION_STEWARD_HISTORY_REPORT_LIBRARY_ID, libraryVersion: 1, reportCount: checked.length, state: latest?.state || 'insufficient-data', sampleCount: checked.reduce((sum, item) => sum + item.sampleCount, 0), persistence: 'append-only-caller-owned', delivery: 'scheduled-host-integration-required' }); }
export function buildWorkstationStewardHistoryReportPlan(value, environment = 'unknown') { const checked = report(value); const normalized = ['interactive', 'headless'].includes(environment) ? environment : 'unknown'; return Object.freeze({ library: WORKSTATION_STEWARD_HISTORY_REPORT_LIBRARY_ID, environment: normalized, mode: normalized === 'unknown' ? 'profile-required' : checked.state === 'report-ready' ? 'deliver-reviewable-report' : 'collect-more-history', actions: Object.freeze([]) }); }
export function buildWorkstationStewardHistoryReportEnvelope(value, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || !trigger) throw new TypeError('History-report library trigger is required'); return Object.freeze({ library: WORKSTATION_STEWARD_HISTORY_REPORT_LIBRARY_ID, libraryVersion: 1, trigger, generatedAt: new Date(clock(now)).toISOString(), report: report(value) }); }
export function createWorkstationStewardHistoryReportLibrary() { return Object.freeze({ id: WORKSTATION_STEWARD_HISTORY_REPORT_LIBRARY_ID, version: 1, merge: mergeWorkstationStewardHistoryReportReports, plan: buildWorkstationStewardHistoryReportPlan, envelope: buildWorkstationStewardHistoryReportEnvelope }); }
