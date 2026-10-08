/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Storage-trend turbo. It measures bounded free-space movement in health
 * reports and never removes or changes files.
 */

export const WORKSTATION_STORAGE_TREND_TURBO_ID = 'workstation-health.storage-trend';
export const WORKSTATION_STORAGE_TREND_TURBO_VERSION = 1;
export const WORKSTATION_STORAGE_TREND_TRIGGERS = Object.freeze(['system.facts.request', 'workload.changed', 'health.interval']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Workstation storage-trend report must be an object');
  if (report.engine !== 'workstation-health') throw new Error('Workstation storage-trend requires workstation-health reports');
  return report;
}
function requireTrigger(trigger) { if (!WORKSTATION_STORAGE_TREND_TRIGGERS.includes(trigger)) throw new Error(`Unsupported workstation-health storage-trend trigger: ${trigger || 'unknown'}`); return trigger; }
function requireWindow(value) { if (!Number.isInteger(value) || value < 1 || value > 64) throw new RangeError('Workstation storage-trend windowSize must be an integer from 1 to 64'); return value; }
function requireMinimum(value, windowSize) { if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Workstation storage-trend minimumSamples must fit inside the window'); return value; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workstation storage-trend clock must return a number'); return timestamp; }
function evidence(report) { const storage = report.storage; return Object.freeze({ freeBytes: Number.isFinite(storage?.freeBytes) && storage.freeBytes >= 0 ? storage.freeBytes : null, pressure: typeof storage?.pressureLevel === 'string' ? storage.pressureLevel : 'unknown' }); }
function stateFor(count, minimum, values) { if (count < minimum) return 'insufficient-data'; if (values.some((item) => item.freeBytes === null)) return 'observation-required'; const delta = values.at(-1).freeBytes - values[0].freeBytes; if (delta < 0) return 'free-space-loss'; if (delta > 0) return 'free-space-gain'; return 'stable-free-space'; }
function confidence(values, minimum) { if (!values.length) return 0; return Math.round((values.filter((item) => item.freeBytes !== null).length / values.length) * Math.min(1, values.length / minimum) * 10000) / 10000; }
function recommendations(state) { if (state === 'insufficient-data') return Object.freeze(['collect-more-storage-trend-samples']); if (state === 'observation-required') return Object.freeze(['request-storage-trend-observation']); if (state === 'free-space-loss') return Object.freeze(['review-storage-pressure-guard']); if (state === 'free-space-gain') return Object.freeze(['record-storage-recovery']); return Object.freeze(['no-change']); }
export function runWorkstationStorageTrendTurbo(samples = [], { trigger, windowSize = 16, minimumSamples = 2, now = Date.now } = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Workstation storage-trend samples must be an array');
  const window = requireWindow(windowSize); const minimum = requireMinimum(minimumSamples, window); const selected = samples.slice(-window).map(requireReport); const values = selected.map(evidence); const state = stateFor(values.length, minimum, values); const delta = values.length > 1 && values.every((item) => item.freeBytes !== null) ? values.at(-1).freeBytes - values[0].freeBytes : null;
  return Object.freeze({ protocolVersion: 1, turbo: WORKSTATION_STORAGE_TREND_TURBO_ID, turboVersion: WORKSTATION_STORAGE_TREND_TURBO_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), sampleCount: values.length, minimumSamples: minimum, observedCount: values.filter((item) => item.freeBytes !== null).length, finalFreeBytes: values.at(-1)?.freeBytes ?? null, deltaBytes: delta, state, confidence: confidence(values, minimum), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
