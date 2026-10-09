/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Local resource-limit planning for explicitly approved background processes.
 * The platform adapter remains the enforcement authority; unsupported limits
 * are returned as explicit adapter refusals.
 */

import { MAX_RESOURCE_IO_BYTES_PER_SECOND, MAX_RESOURCE_MEMORY_BYTES, MIN_RESOURCE_MEMORY_BYTES } from './protocol.js';

export const RESOURCE_LIMITS_VERSION = 1;
const DIMENSIONS = Object.freeze(['cpuPercent', 'memoryBytes', 'ioBytesPerSecond']);
const PROTECTED_ROLES = new Set(['system', 'runtime', 'model', 'credential', 'shell']);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function pid(value) { return Number.isInteger(value) && value > 0 && value <= 2147483647 ? value : null; }
function validDevice(value) { return typeof value === 'string' && /^[1-9]\d*:\d+$/u.test(value); }
function finiteLimit(dimension, value) {
  if (!Number.isInteger(value) || value <= 0) return null;
  if (dimension === 'cpuPercent' && value > 100) return null;
  if (dimension === 'memoryBytes' && (value < MIN_RESOURCE_MEMORY_BYTES || value > MAX_RESOURCE_MEMORY_BYTES)) return null;
  if (dimension === 'ioBytesPerSecond' && value > MAX_RESOURCE_IO_BYTES_PER_SECOND) return null;
  return value;
}
function rows(value) { return Array.isArray(value) ? value.filter(record).slice(0, 512) : []; }
function targetPids(value) { return Array.isArray(value) ? [...new Set(value.map(pid).filter(Boolean))].slice(0, 128) : []; }
function protectedProcess(item) {
  return item.protected === true || item.foreground === true || PROTECTED_ROLES.has(typeof item.role === 'string' ? item.role.trim().toLowerCase() : '');
}
function selectedProcesses(facts, targets) {
  const allowed = targets.length ? new Set(targets) : null;
  return rows(facts.processes).filter((item) => {
    const processPid = pid(item.pid);
    return processPid && !protectedProcess(item) && (!allowed || allowed.has(processPid));
  });
}
function normalizedLimits(value) {
  const source = record(value) ? value : {};
  return Object.freeze({ ...Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, finiteLimit(dimension, source[dimension])] )), ioDevice: validDevice(source.ioDevice) ? source.ioDevice : null });
}
function operationFor(process, dimension, limit, device) {
  const value = dimension === 'cpuPercent' ? 'cpu-percent' : dimension === 'memoryBytes' ? 'memory-bytes' : 'io-bytes-per-second';
  return Object.freeze({
    type: 'set-process-resource-limit',
    key: 'process.resource-limit',
    value,
    limit,
    ...(value === 'io-bytes-per-second' ? { device } : {}),
    pid: pid(process.pid),
    name: typeof process.name === 'string' && process.name.trim() ? process.name.trim() : 'unknown',
    requiresApproval: true,
    reason: `${dimension} hard limit requested`
  });
}
function requireAdapter(adapter) {
  if (!adapter || typeof adapter.applyAction !== 'function') throw new TypeError('Resource limits require a platform adapter');
  return adapter;
}
function approved(approvedPids, targetPid) { return approvedPids === true || (Array.isArray(approvedPids) && approvedPids.includes(targetPid)); }

export function previewResourceLimits(facts = {}, { limits = {}, targetPids: requestedPids = [] } = {}) {
  if (!record(facts)) throw new TypeError('Resource limit facts must be an object');
  const normalized = normalizedLimits(limits);
  const targets = targetPids(requestedPids);
  const selected = selectedProcesses(facts, targets);
  const operations = selected.flatMap((process) => DIMENSIONS
    .filter((dimension) => normalized[dimension] !== null && (dimension !== 'ioBytesPerSecond' || normalized.ioDevice))
    .map((dimension) => operationFor(process, dimension, normalized[dimension], normalized.ioDevice)));
  const configured = DIMENSIONS.some((dimension) => normalized[dimension] !== null);
  const unsupportedDimensions = normalized.ioBytesPerSecond !== null && !normalized.ioDevice ? ['ioBytesPerSecond'] : [];
  return Object.freeze({
    version: RESOURCE_LIMITS_VERSION,
    state: !configured ? 'limit-required' : operations.length ? 'plan-ready' : unsupportedDimensions.length ? 'unsupported-limit' : 'protected-or-unselected',
    limits: normalized,
    targetPids: Object.freeze(targets),
    operations: Object.freeze(operations),
    protectedProcessCount: rows(facts.processes).filter(protectedProcess).length,
    unsupportedDimensions: Object.freeze(['networkBytesPerSecond', 'gpuPercent', ...unsupportedDimensions])
  });
}

export async function applyResourceLimits(plan, { adapter, approvedPids = [], allowAdmin = false, dryRun = true } = {}) {
  requireAdapter(adapter);
  if (!record(plan) || plan.version !== RESOURCE_LIMITS_VERSION || !Array.isArray(plan.operations)) throw new TypeError('Resource limit plan is invalid');
  const report = { dryRun, applied: [], wouldApply: [], skipped: [], adminRequired: [], rejected: [] };
  for (const operation of plan.operations.slice(0, 256)) {
    if (!pid(operation.pid)) { report.rejected.push({ operation, reason: 'operation PID is invalid' }); continue; }
    if (!approved(approvedPids, operation.pid)) { report.skipped.push({ operation, reason: 'explicit PID approval required' }); continue; }
    const action = { type: operation.type, key: operation.key, value: operation.value, limit: operation.limit, ...(operation.device ? { device: operation.device } : {}) };
    if (adapter.requiresAdmin?.(action) === true) {
      report.adminRequired.push({ operation, approved: allowAdmin });
      if (!allowAdmin) continue;
    }
    if (dryRun) { report.wouldApply.push(operation); continue; }
    try {
      const result = await adapter.applyAction(action, { targetPid: operation.pid, approvedBackgroundPids: approvedPids, approved: true, allowAdmin });
      if (result?.ok === false) report.rejected.push({ operation, result, reason: result.reason || 'adapter rejected resource limit' });
      else report.applied.push({ operation, result });
    } catch (error) { report.rejected.push({ operation, reason: error.message }); }
  }
  return Object.freeze(report);
}
