/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Cross-platform workload coexistence authority. It can preview and, after
 * explicit PID approval, apply supported process and I/O priorities. CPU,
 * memory, and GPU hard caps remain explicit unsupported outcomes.
 */

export const WORKLOAD_GOVERNOR_VERSION = 1;
export const WORKLOAD_MODES = Object.freeze(['balanced', 'developer', 'gaming', 'gaming-build']);
const PRIORITIES = Object.freeze(['low', 'normal', 'high']);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function pid(value) { return Number.isInteger(value) && value > 0 ? value : null; }
function rows(value) { return Array.isArray(value) ? value.filter(record).slice(0, 512) : []; }
function list(value, limit = 32) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim().toLowerCase()).slice(0, limit) : []; }
function priority(value, fallback = 'low') { return PRIORITIES.includes(value) ? value : fallback; }
function observedPriority(value) { return PRIORITIES.includes(value) ? value : null; }
function requireFacts(facts) { if (!record(facts)) throw new TypeError('Workload governor facts must be an object'); return facts; }
function requireMode(mode) { if (!WORKLOAD_MODES.includes(mode)) throw new Error(`Unsupported workload mode: ${mode || 'unknown'}`); return mode; }
function requireAdapter(adapter) { if (!adapter || typeof adapter.applyAction !== 'function') throw new TypeError('Workload governor requires a platform adapter'); return adapter; }

function declaredGame(facts) {
  const game = record(facts.game) ? facts.game : {};
  return game.detected === true ? { detected: true, pid: pid(game.pid), name: text(game.name), source: 'declared', confidence: 1 } : null;
}

function detectGame(facts, gameNames) {
  const declared = declaredGame(facts);
  if (declared) return Object.freeze(declared);
  const processes = rows(facts.processes);
  const explicit = processes.find((process) => {
    if (!pid(process.pid) || !['game', 'gaming'].includes(text(process.role)?.toLowerCase())) return false;
    return process.foreground === true || Boolean(text(process.path));
  });
  if (explicit) {
    const source = explicit.foreground === true ? 'process-role' : 'trusted-process-path';
    return Object.freeze({ detected: true, pid: pid(explicit.pid), name: text(explicit.name), source, confidence: source === 'process-role' ? 0.8 : 0.9 });
  }
  const named = processes.find((process) => pid(process.pid) && gameNames.includes((text(process.name) || '').toLowerCase()));
  if (named) return Object.freeze({ detected: true, pid: pid(named.pid), name: text(named.name), source: 'explicit-name', confidence: 0.7 });
  return Object.freeze({ detected: false, pid: null, name: null, source: 'no-explicit-game-evidence', confidence: 0 });
}

function budget(source) {
  const requested = record(source.resourceBudget) ? source.resourceBudget : {};
  return Object.freeze({
    cpuPercent: Number.isFinite(requested.cpuPercent) && requested.cpuPercent >= 0 && requested.cpuPercent <= 100 ? requested.cpuPercent : null,
    memoryBytes: Number.isFinite(requested.memoryBytes) && requested.memoryBytes >= 0 ? requested.memoryBytes : null,
    ioBytesPerSecond: Number.isFinite(requested.ioBytesPerSecond) && requested.ioBytesPerSecond >= 0 ? requested.ioBytesPerSecond : null,
    gpuPercent: Number.isFinite(requested.gpuPercent) && requested.gpuPercent >= 0 && requested.gpuPercent <= 100 ? requested.gpuPercent : null
  });
}

function candidates(facts, game, backgroundPids) {
  const allowed = backgroundPids.length ? new Set(backgroundPids) : null;
  return rows(facts.processes).filter((process) => {
    const processPid = pid(process.pid);
    return processPid && processPid !== game.pid && process.foreground !== true && process.protected !== true && text(process.role)?.toLowerCase() !== 'system' && (!allowed || allowed.has(processPid));
  });
}

function operation(type, key, value, process, reason, previousValue) {
  return Object.freeze({ type, key, value, previousValue, pid: pid(process.pid), name: text(process.name) || 'unknown', requiresApproval: true, reason });
}

export function previewWorkloadPolicy(facts, { mode = 'balanced', gameNames = [], backgroundPids = [], processPriority = 'low', ioPriority = 'low' } = {}) {
  const source = requireFacts(facts);
  const selectedMode = requireMode(mode);
  const names = list(gameNames);
  const pids = [...new Set((Array.isArray(backgroundPids) ? backgroundPids : []).map(pid).filter(Boolean))].slice(0, 128);
  const game = detectGame(source, names);
  const shouldProtectForeground = ['gaming', 'gaming-build'].includes(selectedMode) && game.detected;
  const selected = shouldProtectForeground ? candidates(source, game, pids) : [];
  const operations = selected.flatMap((process) => [
    operation('set-process-priority', 'process.priority', priority(processPriority), process, 'background workload yields to the explicit foreground game', observedPriority(process.priority)),
    operation('set-process-io-priority', 'process.io', priority(ioPriority), process, 'background I/O yields to the explicit foreground game', observedPriority(process.ioPriority))
  ]);
  return Object.freeze({
    version: WORKLOAD_GOVERNOR_VERSION,
    mode: selectedMode,
    game,
    state: game.detected ? 'plan-ready' : 'observation-only',
    budget: budget(source),
    operations: Object.freeze(operations),
    unsupportedBudgetDimensions: Object.freeze(['cpu-hard-cap', 'memory-hard-cap', 'gpu-hard-cap']),
    restore: Object.freeze({ state: 'review-required', reason: 'exact pre-change priority is not present in the telemetry contract' }),
    protectedProcessCount: rows(source.processes).filter((process) => process.protected === true).length
  });
}

function approved(approvedPids, targetPid) { return approvedPids === true || (Array.isArray(approvedPids) && approvedPids.includes(targetPid)); }

export async function applyWorkloadPolicy(plan, { adapter, approvedPids = [], allowAdmin = false, dryRun = true } = {}) {
  requireAdapter(adapter);
  if (!record(plan) || plan.version !== WORKLOAD_GOVERNOR_VERSION || !Array.isArray(plan.operations)) throw new TypeError('Workload governor plan is invalid');
  const report = { dryRun, applied: [], wouldApply: [], skipped: [], adminRequired: [], rejected: [] };
  for (const operationItem of plan.operations.slice(0, 256)) {
    if (!pid(operationItem.pid)) { report.rejected.push({ operation: operationItem, reason: 'operation PID is invalid' }); continue; }
    if (!approved(approvedPids, operationItem.pid)) { report.skipped.push({ operation: operationItem, reason: 'explicit PID approval required' }); continue; }
    const action = { type: operationItem.type, key: operationItem.key, value: operationItem.value };
    if (adapter.requiresAdmin?.(action) === true) {
      report.adminRequired.push({ operation: operationItem, approved: allowAdmin });
      if (!allowAdmin) continue;
    }
    if (dryRun) { report.wouldApply.push(operationItem); continue; }
    try {
      const result = await adapter.applyAction(action, { targetPid: operationItem.pid, approvedBackgroundPids: approvedPids, approved: true, allowProcessStop: false });
      if (result?.ok === false) report.rejected.push({ operation: operationItem, result, reason: result.reason || 'adapter rejected workload operation' });
      else report.applied.push({ operation: operationItem, result });
    } catch (error) { report.rejected.push({ operation: operationItem, reason: error.message }); }
  }
  return Object.freeze(report);
}

