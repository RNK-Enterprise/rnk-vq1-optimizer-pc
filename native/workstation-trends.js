/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded multi-day trend reduction over caller-owned steward history.
 */

export const WORKSTATION_TRENDS_VERSION = 1;
const MAX_ENTRIES = 4096;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function number(value) { return Number.isFinite(value) ? value : null; }
function rows(value) { return Array.isArray(value) ? value.filter(record) : []; }
function metricSeries(samples, selector) { return samples.map(selector).filter((value) => value !== null); }
function trendOf(values, from, to) { const first = values[0] ?? null; const last = values.at(-1) ?? null; const delta = first === null || last === null ? null : last - first; const days = (to - from) / (24 * 60 * 60 * 1000); return Object.freeze({ first, latest: last, delta, direction: delta === null ? 'unknown' : delta > 0 ? 'rising' : delta < 0 ? 'falling' : 'stable', perDay: delta === null || days <= 0 ? null : delta / days, count: values.length }); }

function factSample(entry) {
  const facts = record(entry.facts) ? entry.facts : {};
  const storage = record(facts.storagePressure) ? facts.storagePressure : rows(facts.storage)[0] || {};
  const battery = rows(facts.battery?.batteries)[0] || {};
  const thermal = record(facts.thermals) ? facts.thermals : {};
  const memory = record(facts.memory) ? facts.memory : {};
  const drives = rows(facts.drives?.drives);
  return Object.freeze({ timestamp: entry.timestamp, storageFreeBytes: number(storage.freeBytes), batteryHealthPercent: number(battery.healthPercent), thermalC: number(thermal.maxTemperatureC), memoryUsedPercent: number(memory.usedPercent), driveFailures: drives.filter((item) => item.health === 'failed').length });
}

export function buildWorkstationTrends(entries, { now = Date.now, windowMs = 30 * 24 * 60 * 60 * 1000, maxEntries = 512 } = {}) {
  if (!Array.isArray(entries)) throw new TypeError('Workstation trends entries must be an array');
  if (entries.length > MAX_ENTRIES) throw new RangeError('Workstation trends entries exceed the bound');
  if (typeof now !== 'function') throw new TypeError('Workstation trends clock must be a function');
  const to = now();
  if (!Number.isFinite(to)) throw new TypeError('Workstation trends clock must return a number');
  if (!Number.isInteger(windowMs) || windowMs < 24 * 60 * 60 * 1000 || windowMs > 365 * 24 * 60 * 60 * 1000) throw new RangeError('Workstation trends window is out of range');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES) throw new RangeError('Workstation trends maxEntries is out of range');
  const from = to - windowMs;
  const samples = entries.filter((entry) => record(entry) && entry.event === 'report' && Number.isFinite(entry.timestamp) && entry.timestamp >= from && entry.timestamp <= to).slice(-maxEntries).map(factSample);
  const storage = trendOf(metricSeries(samples, (item) => item.storageFreeBytes), from, to);
  const battery = trendOf(metricSeries(samples, (item) => item.batteryHealthPercent), from, to);
  const thermal = trendOf(metricSeries(samples, (item) => item.thermalC), from, to);
  const memory = trendOf(metricSeries(samples, (item) => item.memoryUsedPercent), from, to);
  const failures = trendOf(metricSeries(samples, (item) => item.driveFailures), from, to);
  const recommendations = [];
  if (storage.direction === 'falling') recommendations.push('storage-is-filling');
  if (battery.direction === 'falling') recommendations.push('battery-health-is-declining');
  if (thermal.delta !== null && thermal.delta >= 5) recommendations.push('thermal-readings-are-rising');
  if (memory.delta !== null && memory.delta >= 5) recommendations.push('memory-pressure-is-rising');
  if (failures.latest > 0) recommendations.push('drive-failure-evidence-present');
  if (!recommendations.length) recommendations.push(samples.length ? 'no-material-change-observed' : 'collect-workstation-evidence');
  return Object.freeze({ version: WORKSTATION_TRENDS_VERSION, period: 'multi-day', window: Object.freeze({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), windowMs }), sampleCount: samples.length, storage: storage, battery: battery, thermals: thermal, memory: memory, drives: failures, recommendations: Object.freeze(recommendations) });
}
