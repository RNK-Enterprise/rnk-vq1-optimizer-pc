/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Workload-policy library. It merges policy observations and exposes a
 * deterministic plan record without mutating host state.
 */

export const WORKLOAD_POLICY_LIBRARY_ID = 'workload-policy-library';
export const WORKLOAD_POLICY_LIBRARY_VERSION = 1;
const MODES = Object.freeze(['developer', 'gaming', 'gaming-build', 'idle', 'unknown']);
const STATES = Object.freeze(['plan-ready', 'observation-required']);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Workload-policy library report must be an object');
  if (report.engine !== 'workload-policy') throw new Error('Workload-policy library requires a workload-policy report');
  if (!MODES.includes(report.mode)) throw new Error('Workload-policy library report has an invalid mode');
  if (!STATES.includes(report.state)) throw new Error('Workload-policy library report has an invalid state');
  if (!Array.isArray(report.recommendations) || !Array.isArray(report.actions)) throw new TypeError('Workload-policy library report requires recommendations and actions');
  return report;
}
function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Workload-policy library reports must be an array');
  if (reports.length > 64) throw new RangeError('Workload-policy library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}
function priority(mode) { return { 'gaming-build': 4, gaming: 3, developer: 2, idle: 1, unknown: 0 }[mode]; }
function mergedMode(reports) { return reports.reduce((winner, report) => priority(report.mode) > priority(winner) ? report.mode : winner, 'unknown'); }
function unique(reports, field) { return Object.freeze([...new Set(reports.flatMap((report) => report[field]))]); }
function requireEnvironment(value) { return ['interactive', 'headless', 'unknown'].includes(value) ? value : 'unknown'; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workload-policy library clock must return a number'); return timestamp; }

export function mergeWorkloadPolicyReports(reports) {
  const validated = requireReports(reports);
  const mode = mergedMode(validated);
  const latest = validated.at(-1) || null;
  const state = validated.length && validated.every((report) => report.state === 'plan-ready') ? 'plan-ready' : 'observation-required';
  return Object.freeze({ library: WORKLOAD_POLICY_LIBRARY_ID, libraryVersion: WORKLOAD_POLICY_LIBRARY_VERSION, reportCount: validated.length, mode, state, foregroundClass: latest?.foregroundClass || null, activeClasses: latest?.activeClasses || [], recommendations: unique(validated, 'recommendations') });
}

export function buildWorkloadPolicyPlan(report, environment = 'unknown') {
  const validated = requireReport(report);
  const normalizedEnvironment = requireEnvironment(environment);
  const mode = normalizedEnvironment === 'unknown' ? 'profile-required' : validated.mode;
  return Object.freeze({ library: WORKLOAD_POLICY_LIBRARY_ID, environment: normalizedEnvironment, mode, requiresApproval: validated.state === 'plan-ready', actions: Object.freeze([]) });
}

export function buildWorkloadPolicyEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || !trigger) throw new TypeError('Workload-policy library trigger is required');
  return Object.freeze({ library: WORKLOAD_POLICY_LIBRARY_ID, libraryVersion: WORKLOAD_POLICY_LIBRARY_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) });
}

export function createWorkloadPolicyLibrary() {
  return Object.freeze({ id: WORKLOAD_POLICY_LIBRARY_ID, version: WORKLOAD_POLICY_LIBRARY_VERSION, merge: mergeWorkloadPolicyReports, plan: buildWorkloadPolicyPlan, envelope: buildWorkloadPolicyEnvelope });
}
