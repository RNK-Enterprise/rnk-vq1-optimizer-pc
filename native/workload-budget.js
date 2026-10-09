/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Cross-platform workload budget supervision. Priority mode produces approved
 * priority reductions; hard mode routes bounded CPU and memory limits through
 * the existing resource-limit adapter authority. GPU limits remain evidence
 * only because portable hard-cap authority is not available here.
 */

import { MAX_RESOURCE_IO_BYTES_PER_SECOND, MAX_RESOURCE_MEMORY_BYTES, MIN_RESOURCE_MEMORY_BYTES } from './protocol.js';

export const WORKLOAD_BUDGET_VERSION = 1;
const DIMENSIONS = Object.freeze(['cpuPercent', 'memoryBytes', 'ioBytesPerSecond', 'gpuPercent']);
const PROTECTED_ROLES = new Set(['system', 'runtime', 'model', 'credential', 'shell']);
const PRIORITIES = new Set(['low', 'normal', 'high']);
const ENFORCEMENTS = new Set(['priority', 'hard']);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function pid(value) { return Number.isInteger(value) && value > 0 && value <= 2147483647 ? value : null; }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function validIoDevice(value) { return typeof value === 'string' && /^[1-9]\d*:\d+$/u.test(value); }
function rows(value) { return Array.isArray(value) ? value.filter(record).slice(0, 512) : []; }
function priority(value) { return PRIORITIES.has(value) ? value : null; }
function enforcement(value) { if (!ENFORCEMENTS.has(value)) throw new Error(`Unsupported workload budget enforcement: ${value || 'unknown'}`); return value; }
function validLimit(dimension, value) {
  if (!Number.isFinite(value) || value < 0) return null;
  return ['cpuPercent', 'gpuPercent'].includes(dimension) && value > 100 ? null : value;
}
function normalizeBudget(value) {
  const source = record(value) ? value : {};
  return Object.freeze({ ...Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, validLimit(dimension, source[dimension])] )), ioDevice: validIoDevice(source.ioDevice) ? source.ioDevice : null });
}
function protectedProcess(item) {
  return item.protected === true || item.foreground === true || PROTECTED_ROLES.has(text(item.role)?.toLowerCase() || '');
}
function selectedProcesses(facts, targetPids) {
  const allowed = targetPids.length ? new Set(targetPids) : null;
  return rows(facts.processes).filter((item) => {
    const processPid = pid(item.pid);
    return processPid && !protectedProcess(item) && (!allowed || allowed.has(processPid));
  });
}
function breachFor(item, dimension, limit) {
  const usage = nonNegative(item[dimension]);
  return usage !== null && limit !== null && usage > limit ? Object.freeze({ dimension, usage, limit }) : null;
}
function hardLimitSupported(dimension, limit, platform, ioDevice) {
  return (dimension === 'cpuPercent' && Number.isInteger(limit) && limit > 0 && limit <= 100)
    || (dimension === 'memoryBytes' && Number.isInteger(limit) && limit >= MIN_RESOURCE_MEMORY_BYTES && limit <= MAX_RESOURCE_MEMORY_BYTES)
    || (dimension === 'ioBytesPerSecond' && platform === 'linux' && Number.isInteger(limit) && limit > 0 && limit <= MAX_RESOURCE_IO_BYTES_PER_SECOND && ioDevice !== null);
}

function operationFor(item, breach, selectedEnforcement, platform, ioDevice) {
  if (selectedEnforcement === 'hard' && hardLimitSupported(breach.dimension, breach.limit, platform, ioDevice)) {
    const value = breach.dimension === 'cpuPercent' ? 'cpu-percent' : breach.dimension === 'memoryBytes' ? 'memory-bytes' : 'io-bytes-per-second';
    return Object.freeze({ type: 'set-process-resource-limit', key: 'process.resource-limit', value, limit: breach.limit, ...(value === 'io-bytes-per-second' ? { device: ioDevice } : {}), previousValue: null, pid: pid(item.pid), name: text(item.name) || 'unknown', requiresApproval: true, reason: `${breach.dimension} hard budget exceeded` });
  }
  const io = breach.dimension === 'ioBytesPerSecond';
  const key = io ? 'process.io' : 'process.priority';
  const type = io ? 'set-process-io-priority' : 'set-process-priority';
  const previousValue = priority(io ? item.ioPriority : item.priority);
  return Object.freeze({ type, key, value: 'low', previousValue, pid: pid(item.pid), name: text(item.name) || 'unknown', requiresApproval: true, reason: `${breach.dimension} budget exceeded` });
}
function targetPidsOption(value) { return Array.isArray(value) ? [...new Set(value.map(pid).filter(Boolean))].slice(0, 128) : []; }
function requireAdapter(adapter) { if (!adapter || typeof adapter.applyAction !== 'function') throw new TypeError('Workload budget requires a platform adapter'); return adapter; }
function approved(approvedPids, targetPid) { return approvedPids === true || (Array.isArray(approvedPids) && approvedPids.includes(targetPid)); }

export function previewWorkloadBudget(facts = {}, { budget = {}, targetPids = [], enforcement: requestedEnforcement = 'priority' } = {}) {
  if (!record(facts)) throw new TypeError('Workload budget facts must be an object');
  const selectedEnforcement = enforcement(requestedEnforcement);
  const limits = normalizeBudget(budget);
  const ioDevice = limits.ioDevice;
  const selected = selectedProcesses(facts, targetPidsOption(targetPids));
  const breaches = [];
  const operations = [];
  selected.forEach((item) => DIMENSIONS.forEach((dimension) => {
    const breach = breachFor(item, dimension, limits[dimension]);
    if (!breach) return;
    const supported = selectedEnforcement === 'hard'
      ? hardLimitSupported(dimension, breach.limit, facts.platform, ioDevice)
      : ['cpuPercent', 'ioBytesPerSecond'].includes(dimension);
    const evidence = Object.freeze({ pid: pid(item.pid), name: text(item.name) || 'unknown', ...breach, enforcement: selectedEnforcement, supported });
    breaches.push(evidence);
    if (evidence.supported) operations.push(operationFor(item, breach, selectedEnforcement, facts.platform, ioDevice));
  }));
  const unsupportedBreaches = breaches.filter((item) => !item.supported);
  const unsupportedDimensions = [...new Set([...(selectedEnforcement === 'hard' ? ['gpuPercent'] : ['memoryBytes', 'gpuPercent']), ...unsupportedBreaches.map((item) => item.dimension)])];
  const state = !DIMENSIONS.some((dimension) => limits[dimension] !== null)
    ? 'budget-required'
    : operations.length
      ? 'plan-ready'
      : unsupportedBreaches.length
        ? 'unsupported-limit'
        : 'within-budget';
  return Object.freeze({ version: WORKLOAD_BUDGET_VERSION, state, enforcement: selectedEnforcement, budget: limits, targetPids: Object.freeze(targetPidsOption(targetPids)), breaches: Object.freeze(breaches), operations: Object.freeze(operations), restore: Object.freeze(operations.filter((item) => item.previousValue).map((item) => Object.freeze({ ...item, value: item.previousValue, previousValue: 'low' }))), unsupportedDimensions: Object.freeze(unsupportedDimensions), protectedProcessCount: rows(facts.processes).filter(protectedProcess).length });
}

export async function applyWorkloadBudget(plan, { adapter, approvedPids = [], allowAdmin = false, dryRun = true } = {}) {
  requireAdapter(adapter);
  if (!record(plan) || plan.version !== WORKLOAD_BUDGET_VERSION || !Array.isArray(plan.operations)) throw new TypeError('Workload budget plan is invalid');
  const report = { dryRun, applied: [], wouldApply: [], skipped: [], adminRequired: [], rejected: [] };
  for (const operation of plan.operations.slice(0, 256)) {
    if (!pid(operation.pid)) { report.rejected.push({ operation, reason: 'operation PID is invalid' }); continue; }
    if (!approved(approvedPids, operation.pid)) { report.skipped.push({ operation, reason: 'explicit PID approval required' }); continue; }
    const action = { type: operation.type, key: operation.key, value: operation.value, ...(Number.isFinite(operation.limit) ? { limit: operation.limit } : {}) };
    if (adapter.requiresAdmin?.(action) === true) {
      report.adminRequired.push({ operation, approved: allowAdmin });
      if (!allowAdmin) continue;
    }
    if (dryRun) { report.wouldApply.push(operation); continue; }
    try {
      const result = await adapter.applyAction(action, { targetPid: operation.pid, approvedBackgroundPids: approvedPids, approved: true, allowProcessStop: false, allowAdmin });
      if (result?.ok === false) report.rejected.push({ operation, result, reason: result.reason || 'adapter rejected budget action' });
      else report.applied.push({ operation, result });
    } catch (error) { report.rejected.push({ operation, reason: error.message }); }
  }
  return Object.freeze(report);
}

export function createWorkloadBudgetMonitor({ adapter, budget, targetPids = [], enforcement: requestedEnforcement = 'priority', intervalMs = 10000, autoApply = false, approvedPids = [], allowAdmin = false, onPlan = () => {}, onError = () => {}, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  requireAdapter(adapter);
  if (autoApply === true && approvedPids !== true && (!Array.isArray(approvedPids) || approvedPids.length === 0)) throw new Error('Automatic workload budget application requires approved PIDs');
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 86400000) throw new RangeError('Workload budget monitor interval is out of range');
  if (typeof onPlan !== 'function' || typeof onError !== 'function' || typeof setIntervalImpl !== 'function' || typeof clearIntervalImpl !== 'function') throw new TypeError('Workload budget monitor callbacks and timers must be callable');
  let timer = null;
  let running = false;
  async function collect() {
    const facts = await adapter.collectFacts();
    const plan = previewWorkloadBudget(facts, { budget, targetPids, enforcement: requestedEnforcement });
    const report = autoApply === true && plan.operations.length ? await applyWorkloadBudget(plan, { adapter, approvedPids, allowAdmin, dryRun: false }) : null;
    await onPlan(plan, report, facts);
    return Object.freeze({ plan, report, facts });
  }
  function start() {
    if (running) return Object.freeze({ started: false, reason: 'already-running' });
    running = true;
    timer = setIntervalImpl(() => { collect().catch(onError); }, intervalMs);
    return Object.freeze({ started: true, intervalMs });
  }
  function stop() {
    if (!running) return Object.freeze({ stopped: false, reason: 'not-running' });
    clearIntervalImpl(timer);
    timer = null;
    running = false;
    return Object.freeze({ stopped: true });
  }
  return Object.freeze({ version: WORKLOAD_BUDGET_VERSION, intervalMs, collect, start, stop, isRunning: () => running });
}
