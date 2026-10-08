/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 * History-report turbo. It creates append-only-friendly trend evidence and a
 * daily report payload; persistence and delivery remain explicit authorities.
 */

export const WORKSTATION_STEWARD_HISTORY_REPORT_TURBO_ID = 'workstation-steward.history-report';
export const WORKSTATION_STEWARD_HISTORY_REPORT_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function value(row, names) { for (const name of names) if (Number.isFinite(row?.[name])) return row[name]; return null; }
function trend(rows, names) { const numbers = rows.map((row) => value(row, names)).filter((item) => item !== null); if (numbers.length < 2) return Object.freeze({ state: numbers.length ? 'single-observation' : 'observation-required', delta: null }); const delta = numbers.at(-1) - numbers[0]; return Object.freeze({ state: delta > 0 ? 'rising' : delta < 0 ? 'falling' : 'stable', delta }); }
function clock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workstation-steward history-report clock must return a number'); return timestamp; }
function triggerOf(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported workstation-steward history-report trigger: ${trigger || 'unknown'}`); return trigger; }

export function runWorkstationStewardHistoryReportTurbo(samples = [], { trigger, now = Date.now } = {}) {
  triggerOf(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Workstation-steward history-report samples must be an array');
  const timestamp = clock(now);
  const selected = samples.filter(record).slice(-256);
  const latest = selected.at(-1) || {};
  const storage = trend(selected, ['storageFreeBytes', 'freeBytes']);
  const battery = trend(selected, ['batteryHealthPercent', 'batteryHealth']);
  const thermal = trend(selected, ['thermalMaxC', 'maxTemperatureC']);
  const memory = trend(selected, ['memoryUsedBytes', 'usedBytes']);
  const report = Object.freeze({ storage: Object.freeze({ freeBytes: value(latest, ['storageFreeBytes', 'freeBytes']), trend: storage }), memory: Object.freeze({ usedBytes: value(latest, ['memoryUsedBytes', 'usedBytes']), trend: memory }), cpu: Object.freeze({ percent: value(latest, ['cpuPercent', 'cpuLoadPercent']) }), gpu: Object.freeze({ percent: value(latest, ['gpuPercent', 'gpuLoadPercent']) }), thermals: Object.freeze({ maxC: value(latest, ['thermalMaxC', 'maxTemperatureC']), trend: thermal }), battery: Object.freeze({ healthPercent: value(latest, ['batteryHealthPercent', 'batteryHealth']), trend: battery }), network: Object.freeze({ topConsumers: Array.isArray(latest.networkConsumers) ? latest.networkConsumers.slice(0, 16) : [] }), cleanup: Object.freeze({ recoveredBytes: value(latest, ['cleanupRecoveredBytes', 'recoveredBytes']) || 0 }), development: Object.freeze({ workloads: Array.isArray(latest.workloads) ? latest.workloads.slice(0, 16) : [] }), gaming: Object.freeze({ pressure: text(latest.gamingPressure) || 'unknown' }), recommendations: Object.freeze(selected.length ? ['review-storage-trend', 'review-resource-trend', 'review-thermal-and-battery-trend'] : ['collect-daily-workstation-evidence']) });
  const state = !selected.length ? 'insufficient-data' : [storage, battery, thermal, memory].every((item) => item.state === 'observation-required') ? 'observation-required' : 'report-ready';
  return Object.freeze({ protocolVersion: 1, turbo: WORKSTATION_STEWARD_HISTORY_REPORT_TURBO_ID, turboVersion: 1, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, persistence: 'append-only-caller-owned', delivery: 'scheduled-host-integration-required', state, trends: Object.freeze({ storage, battery, thermal, memory }), report, actions: Object.freeze([]) });
}
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
