/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Resource-governance turbo. It detects a foreground game, identifies
 * background budget pressure, and explains reversible review actions.
 */

export const WORKSTATION_STEWARD_RESOURCE_GOVERNANCE_TURBO_ID = 'workstation-steward.resource-governance';
export const WORKSTATION_STEWARD_RESOURCE_GOVERNANCE_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
const EMPTY = Object.freeze([]);
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function number(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function platformOf(value) { const normalized = text(value)?.toLowerCase(); return ['win32', 'linux', 'darwin', 'unknown'].includes(normalized) ? normalized : 'unknown'; }
function requireTrigger(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported workstation-steward resource-governance trigger: ${trigger || 'unknown'}`); return trigger; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workstation-steward resource-governance clock must return a number'); return timestamp; }
function budgetOf(sample, input) { const source = record(input.budget) ? input.budget : record(sample.budget) ? sample.budget : {}; return Object.freeze({ cpuPercent: number(source.cpuPercent) ?? 50, memoryBytes: number(source.memoryBytes) ?? 8 * 1024 ** 3, ioBytesPerSecond: number(source.ioBytesPerSecond) ?? 50 * 1024 ** 2, gpuPercent: number(source.gpuPercent) ?? 35 }); }
function overBudget(process, budget) { return (number(process.cpuPercent) ?? 0) > budget.cpuPercent || (number(process.memoryBytes) ?? 0) > budget.memoryBytes || (number(process.ioBytesPerSecond) ?? 0) > budget.ioBytesPerSecond || (number(process.gpuPercent) ?? 0) > budget.gpuPercent; }
function gameOf(sample) { const process = Array.isArray(sample.processes) ? sample.processes.find((item) => record(item) && item.foreground && ['game', 'gaming'].includes(text(item.role)?.toLowerCase())) : null; return sample.gameDetected === true || Boolean(process); }

export function runWorkstationStewardResourceGovernanceTurbo(samples = [], { trigger, budget = null, now = Date.now } = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Workstation-steward resource-governance samples must be an array');
  const timestamp = requireClock(now);
  const selected = samples.slice(-64);
  const sample = selected.at(-1) || {};
  const platform = platformOf(sample.platform || sample.os?.platform);
  const processes = Array.isArray(sample.processes) ? sample.processes.filter(record) : [];
  const limits = budgetOf(sample, { budget });
  const gameDetected = gameOf(sample);
  const candidates = processes.filter((item) => !item.foreground && item.protected !== true && item.role !== 'system' && Number.isInteger(item.pid) && item.pid > 0);
  const pressured = candidates.filter((item) => overBudget(item, limits));
  const state = !selected.length ? 'insufficient-data' : !processes.length ? 'observation-required' : gameDetected && pressured.length ? 'enforcement-review' : gameDetected ? 'game-observed' : pressured.length ? 'budget-review' : 'stable';
  const actions = pressured.map((item) => Object.freeze({ type: 'budget-process', pid: item.pid, name: text(item.name) || 'unknown', reversible: true, requiresApproval: true, explanation: gameDetected ? 'yield background work to the foreground game' : 'bring workload inside its declared resource budget' }));
  return Object.freeze({ protocolVersion: 1, turbo: WORKSTATION_STEWARD_RESOURCE_GOVERNANCE_TURBO_ID, turboVersion: WORKSTATION_STEWARD_RESOURCE_GOVERNANCE_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), platform, sampleCount: selected.length, gameDetected, budget: limits, pressuredProcessIds: Object.freeze(pressured.map((item) => item.pid)), protectedProcessCount: processes.filter((item) => item.protected === true).length, startupReviewCount: Array.isArray(sample.startup) ? sample.startup.filter(record).length : 0, state, actions: Object.freeze(actions), recommendations: Object.freeze(state === 'enforcement-review' ? ['review-background-budget-actions', 'restore-on-game-exit'] : state === 'budget-review' ? ['review-resource-budget'] : state === 'game-observed' ? ['preserve-game-foreground'] : state === 'observation-required' ? ['collect-process-evidence'] : []), unsupportedAuthority: 'cpu-memory-io-gpu-hard-caps-require-platform-approved-control' });
}
