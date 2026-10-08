/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Resource-budget library for merging bounded budget observations.
 */

export const WORKLOAD_POLICY_RESOURCE_BUDGET_LIBRARY_ID = 'workload-policy.resource-budget.library';
export const WORKLOAD_POLICY_RESOURCE_BUDGET_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['within-budget', 'budget-exceeded', 'observation-required', 'insufficient-data']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) { if (!isRecord(report)) throw new TypeError('Resource-budget library report must be an object'); if (report.turbo !== 'workload-policy.resource-budget') throw new Error('Resource-budget library requires a resource-budget turbo report'); if (!STATES.includes(report.state)) throw new Error('Resource-budget library report has an invalid state'); if (!Array.isArray(report.violations)) throw new TypeError('Resource-budget library report requires violations'); return report; }
function requireReports(reports) { if (!Array.isArray(reports)) throw new TypeError('Resource-budget library reports must be an array'); if (reports.length > 64) throw new RangeError('Resource-budget library accepts at most 64 reports'); return Object.freeze(reports.map(requireReport)); }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Resource-budget library clock must return a number'); return timestamp; }
export function mergeWorkloadPolicyResourceBudgetReports(reports) { const validated = requireReports(reports); const state = validated.some((report) => report.state === 'budget-exceeded') ? 'budget-exceeded' : validated.some((report) => report.state === 'observation-required') ? 'observation-required' : validated.some((report) => report.state === 'within-budget') ? 'within-budget' : 'insufficient-data'; return Object.freeze({ library: WORKLOAD_POLICY_RESOURCE_BUDGET_LIBRARY_ID, libraryVersion: WORKLOAD_POLICY_RESOURCE_BUDGET_LIBRARY_VERSION, reportCount: validated.length, state, violations: Object.freeze([...new Set(validated.flatMap((report) => report.violations))]) }); }
export function buildWorkloadPolicyResourceBudgetPlan(report, environment = 'unknown') { const validated = requireReport(report); const normalized = ['interactive', 'headless'].includes(environment) ? environment : 'unknown'; return Object.freeze({ library: WORKLOAD_POLICY_RESOURCE_BUDGET_LIBRARY_ID, environment: normalized, mode: normalized === 'unknown' ? 'profile-required' : validated.state === 'budget-exceeded' ? 'approval-required' : 'budget-observation', actions: Object.freeze([]) }); }
export function buildWorkloadPolicyResourceBudgetEnvelope(report, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || !trigger) throw new TypeError('Resource-budget library trigger is required'); return Object.freeze({ library: WORKLOAD_POLICY_RESOURCE_BUDGET_LIBRARY_ID, libraryVersion: WORKLOAD_POLICY_RESOURCE_BUDGET_LIBRARY_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) }); }
export function createWorkloadPolicyResourceBudgetLibrary() { return Object.freeze({ id: WORKLOAD_POLICY_RESOURCE_BUDGET_LIBRARY_ID, version: WORKLOAD_POLICY_RESOURCE_BUDGET_LIBRARY_VERSION, merge: mergeWorkloadPolicyResourceBudgetReports, plan: buildWorkloadPolicyResourceBudgetPlan, envelope: buildWorkloadPolicyResourceBudgetEnvelope }); }
