/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded daily-report reduction for sampled process-resource rates.
 */

import { compareProcessResourceSnapshots } from './process-rate.js';

export const PROCESS_RESOURCE_REPORT_VERSION = 1;
const DEFAULT_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function rows(value) { return Array.isArray(value) ? value.filter(record) : []; }
function metric(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function maximum(values) { return values.length ? Math.max(...values) : null; }

function sampleInterval(previousTimestamp, currentTimestamp) {
  if (previousTimestamp === null) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(1, currentTimestamp - previousTimestamp));
}

function measuredRows(report) { return rows(report?.processes).filter((item) => item.state === 'measured'); }

function topProcess(processes, sourceField, outputField) {
  const ranked = rows(processes)
    .map((item) => ({ item, value: metric(item[sourceField]) }))
    .filter((entry) => entry.value !== null)
    .sort((left, right) => right.value - left.value);
  const top = ranked[0];
  return top ? Object.freeze({ pid: top.item.pid, name: top.item.name, [outputField]: top.value }) : null;
}

export function deriveProcessResourceRateSamples(entries) {
  if (!Array.isArray(entries)) throw new TypeError('Process resource report entries must be an array');
  let previous = null;
  let previousTimestamp = null;
  return Object.freeze(entries.map((entry) => {
    const current = { processes: rows(entry?.facts?.processes) };
    const intervalMs = sampleInterval(previousTimestamp, entry.timestamp);
    const report = compareProcessResourceSnapshots(previous, current, { intervalMs });
    previous = current;
    previousTimestamp = entry.timestamp;
    return report;
  }));
}

export function summarizeProcessResourceRates(samples) {
  if (!Array.isArray(samples)) throw new TypeError('Process resource rate samples must be an array');
  const measured = samples.flatMap(measuredRows);
  const latest = samples.at(-1)?.processes;
  return Object.freeze({
    version: PROCESS_RESOURCE_REPORT_VERSION,
    peakCpuPercent: maximum(measured.map((item) => metric(item.cpuPercent)).filter((value) => value !== null)),
    peakIoBytesPerSecond: maximum(measured.map((item) => metric(item.ioBytesPerSecond)).filter((value) => value !== null)),
    latestTopCpu: topProcess(latest, 'cpuPercent', 'cpuPercent'),
    latestTopIo: topProcess(latest, 'ioBytesPerSecond', 'ioBytesPerSecond'),
    rateSamples: samples.filter((item) => item?.state === 'rate-ready').length,
    counterResetEvents: samples.filter((item) => item?.state === 'counter-reset').length
  });
}
