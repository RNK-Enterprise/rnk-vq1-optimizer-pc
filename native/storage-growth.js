/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded storage-growth evidence. It compares caller-supplied storage
 * pressure previews and never scans, moves, or deletes files itself.
 */

export const STORAGE_GROWTH_VERSION = 1;
export const STORAGE_GROWTH_CATEGORIES = Object.freeze([
  'temporary-files',
  'package-cache',
  'browser-automation-cache',
  'gpu-shader-cache',
  'windows-update-download',
  'abandoned-runtime-remnants'
]);

const MAX_ENTRIES = 4096;
const DAY_MS = 24 * 60 * 60 * 1000;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function finite(value) { return Number.isFinite(value) ? value : null; }
function positiveInteger(value) { return Number.isInteger(value) && value > 0; }

function validateOptions({ windowMs, maxEntries, growthThresholdBytes }) {
  if (!Number.isInteger(windowMs) || windowMs < 60 * 60 * 1000 || windowMs > 365 * DAY_MS) throw new RangeError('Storage growth window is out of range');
  if (!positiveInteger(maxEntries) || maxEntries > MAX_ENTRIES) throw new RangeError('Storage growth maxEntries is out of range');
  if (finite(growthThresholdBytes) === null || growthThresholdBytes < 0) throw new RangeError('Storage growth threshold is invalid');
}

function metric(values, threshold) {
  const first = values[0] ?? null;
  const latest = values.at(-1) ?? null;
  const delta = first === null || latest === null ? null : latest - first;
  const direction = delta === null ? 'unknown' : delta > threshold ? 'rising' : delta < -threshold ? 'falling' : 'stable';
  return Object.freeze({ first, latest, delta, direction, samples: values.length });
}

function valuesFor(entries, selector) {
  return entries.map(selector).filter((value) => value !== null);
}

function normalizeEntry(entry) {
  const source = record(entry) ? entry : {};
  const categories = record(source.categories) ? source.categories : {};
  return Object.freeze({
    timestamp: finite(source.timestamp),
    freeBytes: finite(source.freeBytes),
    reclaimableBytes: finite(source.reclaimableBytes),
    categories: Object.freeze(Object.fromEntries(STORAGE_GROWTH_CATEGORIES.map((category) => [category, finite(categories[category])])))
  });
}

export function buildStorageGrowthReport(entries = [], {
  now = Date.now,
  windowMs = 30 * DAY_MS,
  maxEntries = 512,
  growthThresholdBytes = 1024 ** 2
} = {}) {
  if (!Array.isArray(entries)) throw new TypeError('Storage growth entries must be an array');
  if (entries.length > MAX_ENTRIES) throw new RangeError('Storage growth entries exceed the bound');
  if (typeof now !== 'function') throw new TypeError('Storage growth clock must be a function');
  const to = now();
  if (!Number.isFinite(to)) throw new TypeError('Storage growth clock must return a number');
  validateOptions({ windowMs, maxEntries, growthThresholdBytes });
  const from = to - windowMs;
  const samples = entries.map(normalizeEntry)
    .filter((entry) => entry.timestamp !== null && entry.timestamp >= from && entry.timestamp <= to)
    .slice(-maxEntries);
  const free = metric(valuesFor(samples, (entry) => entry.freeBytes), growthThresholdBytes);
  const reclaimable = metric(valuesFor(samples, (entry) => entry.reclaimableBytes), growthThresholdBytes);
  const categories = Object.fromEntries(STORAGE_GROWTH_CATEGORIES.map((category) => [category, metric(valuesFor(samples, (entry) => entry.categories[category]), growthThresholdBytes)]));
  const growingCategories = Object.entries(categories)
    .filter(([, value]) => value.direction === 'rising')
    .sort((left, right) => right[1].delta - left[1].delta)
    .map(([category, value]) => Object.freeze({ category, ...value }));
  const state = samples.length === 0 ? 'no-data' : free.direction === 'falling' || growingCategories.length ? 'growth-observed' : 'stable';
  const recommendations = [];
  if (state === 'no-data') recommendations.push('collect-storage-growth-evidence');
  if (free.direction === 'falling') recommendations.push('review-system-drive-growth');
  if (growingCategories.length) recommendations.push('review-growing-reclaimable-category');
  if (reclaimable.latest !== null && reclaimable.latest > 0) recommendations.push('review-bounded-cleanup-preview');
  if (!recommendations.length) recommendations.push('no-material-storage-growth-observed');
  return Object.freeze({
    version: STORAGE_GROWTH_VERSION,
    state,
    period: 'bounded-storage-history',
    window: Object.freeze({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), windowMs }),
    sampleCount: samples.length,
    freeBytes: free,
    reclaimableBytes: reclaimable,
    categories: Object.freeze(categories),
    growingCategories: Object.freeze(growingCategories),
    recommendations: Object.freeze(recommendations),
    evidence: Object.freeze({ complete: samples.length > 0 && free.samples > 0, retainedSamples: samples.length })
  });
}

export function createStorageGrowthTracker({ now = Date.now, windowMs = 30 * DAY_MS, maxEntries = 512, growthThresholdBytes = 1024 ** 2 } = {}) {
  if (typeof now !== 'function') throw new TypeError('Storage growth clock must be a function');
  validateOptions({ windowMs, maxEntries, growthThresholdBytes });
  let entries = [];
  function report() { return buildStorageGrowthReport(entries, { now, windowMs, maxEntries, growthThresholdBytes }); }
  function observe(entry) {
    const source = record(entry) ? entry : {};
    const timestamp = finite(source.timestamp) ?? now();
    if (!Number.isFinite(timestamp)) throw new TypeError('Storage growth sample timestamp must be finite');
    entries = [...entries, { ...source, timestamp }].slice(-maxEntries);
    return report();
  }
  function reset() { entries = []; return report(); }
  return Object.freeze({ observe, read: report, reset, size: () => entries.length });
}
