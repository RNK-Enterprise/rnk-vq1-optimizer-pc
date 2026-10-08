/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Deterministic cross-platform workstation policy planning. It combines
 * supplied evidence into approval-gated handoffs and never mutates the host.
 */

export const WORKSTATION_POLICY_VERSION = 1;
const LEVELS = new Set(['normal', 'warning', 'critical', 'emergency']);
const MAX_ACTIONS = 16;
const WORKLOAD_ROLES = new Set(['ai', 'build', 'compiler', 'development', 'model']);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function rows(value) { return Array.isArray(value) ? value.filter(record).slice(0, 512) : []; }
function level(value) { return LEVELS.has(value) ? value : 'unknown'; }
function validMaxActions(value) { if (!Number.isInteger(value) || value < 1 || value > MAX_ACTIONS) throw new RangeError('Workstation policy action bound is out of range'); return value; }
function pressureFromPercent(value) { const percent = nonNegative(value); return percent === null ? 'unknown' : percent >= 95 ? 'critical' : percent >= 80 ? 'warning' : 'normal'; }
function severeStorage(storage) { return ['warning', 'critical', 'emergency'].includes(storage.level) || storage.belowTargetFreeFloor; }
function severeMemory(memory, pagefile) { return ['warning', 'critical', 'emergency'].includes(memory.pressure) || ['warning', 'critical', 'emergency'].includes(pagefile.pressure); }
function severeThermal(thermal) { return thermal.throttling || thermal.temperatureC !== null && thermal.temperatureC >= 90; }
function batterySource(facts) { const battery = record(facts.battery) ? facts.battery : {}; return rows(battery.batteries)[0] || battery; }

function evidence(facts) {
  const storageFacts = record(facts.storagePressure) ? facts.storagePressure : {};
  const memoryFacts = record(facts.memory) ? facts.memory : {};
  const pagefileFacts = record(facts.pagefile) ? facts.pagefile : {};
  const thermalFacts = record(facts.thermals) ? facts.thermals : record(facts.thermal) ? facts.thermal : {};
  const battery = batterySource(facts);
  const processRows = rows(facts.processes);
  const backgroundWorkloads = processRows.filter((item) => item.foreground !== true && item.protected !== true && WORKLOAD_ROLES.has(text(item.role)?.toLowerCase() || ''));
  const abnormalProcesses = processRows.filter((item) => item.abnormal === true || ['crashed', 'failed', 'zombie', 'unresponsive'].includes(text(item.state)?.toLowerCase()));
  const game = record(facts.game) && facts.game.detected === true;
  return Object.freeze({
    storage: Object.freeze({ level: level(storageFacts.level), belowTargetFreeFloor: storageFacts.belowTargetFreeFloor === true }),
    memory: Object.freeze({ pressure: level(memoryFacts.pressure || pressureFromPercent(memoryFacts.usedPercent)) }),
    pagefile: Object.freeze({ pressure: level(pagefileFacts.pressure || pressureFromPercent(pagefileFacts.pressurePercent)) }),
    thermal: Object.freeze({ temperatureC: nonNegative(thermalFacts.maxTemperatureC), throttling: thermalFacts.throttling === true || thermalFacts.thermalThrottling === true }),
    battery: Object.freeze({ healthPercent: nonNegative(battery.healthPercent), chargePercent: nonNegative(battery.capacityPercent ?? battery.chargePercent) }),
    game: Object.freeze({ detected: game, name: game ? text(facts.game.name) : null }),
    backgroundWorkloadCount: backgroundWorkloads.length,
    abnormalProcessCount: abnormalProcesses.length
  });
}

function action(id, operation, reason, observed, requiresApproval = true) {
  return Object.freeze({ id, operation, reason, observed: Object.freeze(observed), mutation: 'none', requiresApproval, handoff: 'delegate-to-existing-authority' });
}

export function buildWorkstationPolicyPlan(facts = {}, { report = null, maxActions = MAX_ACTIONS } = {}) {
  if (!record(facts)) throw new TypeError('Workstation policy facts must be an object');
  const limit = validMaxActions(maxActions);
  const observed = evidence(facts);
  const actions = [];
  if (severeStorage(observed.storage)) actions.push(action('storage-pressure-review', 'storage-preview', 'system storage pressure needs exact reclaimable-path review', observed.storage));
  if (severeMemory(observed.memory, observed.pagefile)) actions.push(action('memory-pressure-review', 'workload-budget-preview', 'memory or pagefile pressure needs bounded workload budgeting', { memory: observed.memory, pagefile: observed.pagefile }));
  if (severeThermal(observed.thermal)) actions.push(action('thermal-workload-review', 'power-recommend', 'thermal margin or throttling needs a safer workload/power recommendation', observed.thermal));
  if (observed.game.detected && observed.backgroundWorkloadCount > 0) actions.push(action('gaming-build-review', 'workload-preview', 'foreground game and background development workloads need explicit coexistence approval', { game: observed.game, backgroundWorkloadCount: observed.backgroundWorkloadCount }));
  if (observed.abnormalProcessCount > 0) actions.push(action('abnormal-process-review', 'process-overview', 'abnormal process evidence needs identity and stop-impact review', { abnormalProcessCount: observed.abnormalProcessCount }, false));
  if (observed.battery.healthPercent !== null && observed.battery.healthPercent < 80) actions.push(action('battery-health-review', 'power-recommend', 'battery health is below the review boundary', observed.battery));
  const bounded = actions.slice(0, limit);
  return Object.freeze({ version: WORKSTATION_POLICY_VERSION, phase: 'recommend', state: bounded.length ? 'recommendations-ready' : 'no-change', observed, actions: Object.freeze(bounded), recommendations: Object.freeze(bounded.map((item) => item.id)), report: record(report) ? report : null, execution: 'no host mutation; approval and delegated authority required' });
}

export function approveWorkstationPolicy(plan, { approvedIds = [] } = {}) {
  if (!record(plan) || plan.version !== WORKSTATION_POLICY_VERSION || plan.phase !== 'recommend' || !Array.isArray(plan.actions)) throw new TypeError('Workstation policy plan is invalid');
  if (!Array.isArray(approvedIds) || approvedIds.length > MAX_ACTIONS) throw new TypeError('Workstation policy approvals must be a bounded id list');
  const allowed = new Set(approvedIds.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()));
  const actions = plan.actions.map((item) => Object.freeze({ ...item, approved: allowed.has(item.id) }));
  return Object.freeze({ ...plan, phase: 'approved', approvedIds: Object.freeze([...allowed]), actions: Object.freeze(actions), execution: 'approved actions must be delegated to their named authority' });
}
