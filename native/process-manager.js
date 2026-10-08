/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Review-first process and startup explanations. Facts identify candidates;
 * platform adapters remain the only authority allowed to stop a process.
 */

export const PROCESS_MANAGER_VERSION = 1;
const EMPTY = Object.freeze([]);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function rows(value) { return Array.isArray(value) ? value.filter(record) : []; }
function validPid(value) { return Number.isInteger(value) && value > 0 && value <= 2147483647; }
function metric(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function normalizedRole(value) { return text(value)?.toLowerCase() || 'unknown'; }
function processRows(facts) { return rows(facts.processes).map((item) => Object.freeze({ ...item, role: normalizedRole(item.role), name: text(item.name) || 'unknown' })); }

function stopReason(process, protectedNames) {
  if (!process) return 'process was not observed';
  if (process.protected === true) return 'process is protected';
  if (process.foreground === true) return 'foreground process is not stoppable by this plan';
  if (['system', 'runtime', 'model', 'credential', 'shell'].includes(process.role)) return `process role ${process.role} is protected by policy`;
  if (protectedNames.some((name) => name.toLowerCase() === process.name.toLowerCase())) return 'process name is protected by policy';
  return null;
}

export function explainProcess(process, { protectedNames = [] } = {}) {
  if (!record(process)) throw new TypeError('Process explanation requires a process record');
  const name = text(process.name) || 'unknown';
  const protectedList = Array.isArray(protectedNames) ? protectedNames.filter((item) => text(item)).map((item) => item.trim()) : EMPTY;
  const refusal = stopReason({ ...process, name }, protectedList);
  return Object.freeze({ version: PROCESS_MANAGER_VERSION, pid: validPid(process.pid) ? process.pid : null, name, role: normalizedRole(process.role), usage: Object.freeze({ cpuPercent: metric(process.cpuPercent), memoryBytes: metric(process.memoryBytes), ioBytesPerSecond: metric(process.ioBytesPerSecond), gpuPercent: metric(process.gpuPercent) }), runtime: Number.isFinite(process.uptimeSeconds) ? process.uptimeSeconds : null, foreground: process.foreground === true, protected: process.protected === true, stop: Object.freeze({ state: refusal ? 'refused' : 'review-ready', reason: refusal || 'background process with no protected role observed', requiresApproval: true, operation: refusal ? null : 'stop-approved-process' }) });
}

export function buildProcessOverview(facts = {}, { protectedNames = [], maxEntries = 128 } = {}) {
  if (!record(facts)) throw new TypeError('Process overview facts must be an object');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 512) throw new RangeError('Process overview maxEntries is out of range');
  const processes = processRows(facts).map((item) => explainProcess(item, { protectedNames })).sort((left, right) => (right.usage.memoryBytes || 0) - (left.usage.memoryBytes || 0)).slice(0, maxEntries);
  const startup = rows(facts.startup?.entries).slice(0, maxEntries).map((item) => Object.freeze({ name: text(item.name) || 'unnamed-startup', location: text(item.location) || 'unknown', command: text(item.command), enabled: item.enabled !== false, authority: 'review-only', change: 'preview-only' }));
  return Object.freeze({ version: PROCESS_MANAGER_VERSION, processCount: processes.length, startupCount: startup.length, processes: Object.freeze(processes), startup: Object.freeze(startup), mutation: 'none' });
}

export function previewProcessStop(facts, pid, { protectedNames = [] } = {}) {
  if (!record(facts)) throw new TypeError('Process stop facts must be an object');
  const target = processRows(facts).find((item) => item.pid === pid);
  const explanation = target ? explainProcess(target, { protectedNames }) : null;
  const refusal = explanation ? explanation.stop.state === 'refused' ? explanation.stop.reason : null : stopReason(null, []);
  return Object.freeze({ version: PROCESS_MANAGER_VERSION, state: refusal ? 'refused' : 'plan-ready', operation: 'stop-approved-process', pid: validPid(pid) ? pid : null, explanation, requiresApproval: true, mutation: 'none', reason: refusal });
}

export async function applyProcessStop(plan, { adapter, approved = false, allowAdmin = false, dryRun = true } = {}) {
  if (!record(plan) || plan.version !== PROCESS_MANAGER_VERSION || plan.operation !== 'stop-approved-process') throw new TypeError('Process stop plan is invalid');
  if (!adapter || typeof adapter.applyAction !== 'function') throw new TypeError('Process stop requires a platform adapter');
  if (plan.state !== 'plan-ready') return Object.freeze({ state: 'refused', applied: false, reason: plan.reason });
  if (!approved) return Object.freeze({ state: 'approval-required', applied: false, reason: 'explicit approval is required' });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, pid: plan.pid });
  if (typeof adapter.requiresAdmin === 'function' && adapter.requiresAdmin({ type: plan.operation }) && !allowAdmin) return Object.freeze({ state: 'admin-required', applied: false, pid: plan.pid });
  try {
    const result = await adapter.applyAction({ type: plan.operation }, { targetPid: plan.pid, approved: true, allowAdmin, allowProcessStop: true, approvedBackgroundPids: [plan.pid] });
    return Object.freeze(result?.ok ? { state: 'applied', applied: true, pid: plan.pid } : { state: 'rejected', applied: false, pid: plan.pid, reason: result?.reason || 'adapter rejected process stop' });
  } catch (error) { return Object.freeze({ state: 'rejected', applied: false, pid: plan.pid, reason: error.message }); }
}
