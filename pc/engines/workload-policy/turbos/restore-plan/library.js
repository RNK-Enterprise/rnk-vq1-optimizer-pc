/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Restore-plan library for aggregating reversible policy intent.
 */

export const WORKLOAD_POLICY_RESTORE_PLAN_LIBRARY_ID = 'workload-policy.restore-plan.library';
export const WORKLOAD_POLICY_RESTORE_PLAN_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['restore-planned', 'no-restore-needed', 'observation-required', 'insufficient-data']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) { if (!isRecord(report)) throw new TypeError('Restore-plan library report must be an object'); if (report.turbo !== 'workload-policy.restore-plan') throw new Error('Restore-plan library requires a restore-plan turbo report'); if (!STATES.includes(report.state)) throw new Error('Restore-plan library report has an invalid state'); if (!Array.isArray(report.restoreActions)) throw new TypeError('Restore-plan library report requires restoreActions'); return report; }
function requireReports(reports) { if (!Array.isArray(reports)) throw new TypeError('Restore-plan library reports must be an array'); if (reports.length > 64) throw new RangeError('Restore-plan library accepts at most 64 reports'); return Object.freeze(reports.map(requireReport)); }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Restore-plan library clock must return a number'); return timestamp; }
export function mergeWorkloadPolicyRestorePlanReports(reports) { const validated = requireReports(reports); const state = validated.some((report) => report.state === 'restore-planned') ? 'restore-planned' : validated.some((report) => report.state === 'observation-required') ? 'observation-required' : validated.some((report) => report.state === 'no-restore-needed') ? 'no-restore-needed' : 'insufficient-data'; return Object.freeze({ library: WORKLOAD_POLICY_RESTORE_PLAN_LIBRARY_ID, libraryVersion: WORKLOAD_POLICY_RESTORE_PLAN_LIBRARY_VERSION, reportCount: validated.length, state, restoreActions: Object.freeze([...new Set(validated.flatMap((report) => report.restoreActions))]) }); }
export function buildWorkloadPolicyRestorePlan(report, environment = 'unknown') { const validated = requireReport(report); const normalized = ['interactive', 'headless'].includes(environment) ? environment : 'unknown'; return Object.freeze({ library: WORKLOAD_POLICY_RESTORE_PLAN_LIBRARY_ID, environment: normalized, mode: normalized === 'unknown' ? 'profile-required' : validated.state === 'restore-planned' ? 'restore-after-exit' : 'no-restore' }); }
export function buildWorkloadPolicyRestorePlanEnvelope(report, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || !trigger) throw new TypeError('Restore-plan library trigger is required'); return Object.freeze({ library: WORKLOAD_POLICY_RESTORE_PLAN_LIBRARY_ID, libraryVersion: WORKLOAD_POLICY_RESTORE_PLAN_LIBRARY_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) }); }
export function createWorkloadPolicyRestorePlanLibrary() { return Object.freeze({ id: WORKLOAD_POLICY_RESTORE_PLAN_LIBRARY_ID, version: WORKLOAD_POLICY_RESTORE_PLAN_LIBRARY_VERSION, merge: mergeWorkloadPolicyRestorePlanReports, plan: buildWorkloadPolicyRestorePlan, envelope: buildWorkloadPolicyRestorePlanEnvelope }); }
