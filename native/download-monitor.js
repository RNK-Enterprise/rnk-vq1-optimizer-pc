/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Trigger-based download progress observation. It compares bounded scanner
 * snapshots and never starts, pauses, redirects, moves, or deletes downloads.
 */

export const DOWNLOAD_MONITOR_VERSION = 1;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function bytes(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function entries(snapshot) { return Array.isArray(snapshot?.entries) ? snapshot.entries.filter(record).slice(0, 512) : []; }

export function compareDownloadSnapshots(previous, current, { intervalMs = 1000 } = {}) {
  if (!record(current)) throw new TypeError('Download monitor current snapshot is required');
  if (previous !== null && previous !== undefined && !record(previous)) throw new TypeError('Download monitor previous snapshot is invalid');
  if (!Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > 24 * 60 * 60 * 1000) throw new RangeError('Download monitor interval is out of range');
  const old = new Map(entries(previous).map((item) => [text(item.path), bytes(item.sizeBytes) || 0]));
  const downloads = entries(current).filter((item) => text(item.path)).map((item) => {
    const path = text(item.path);
    const sizeBytes = bytes(item.sizeBytes) || 0;
    const previousBytes = old.get(path);
    const deltaBytes = previousBytes === undefined ? 0 : Math.max(0, sizeBytes - previousBytes);
    const incomplete = item.incomplete === true;
    const state = incomplete ? previousBytes === undefined ? 'incomplete' : deltaBytes > 0 ? 'active' : 'stalled' : 'complete';
    return Object.freeze({ path, name: text(item.name) || path, sizeBytes, deltaBytes, throughputBytesPerSecond: deltaBytes / (intervalMs / 1000), state, incomplete });
  });
  return Object.freeze({ version: DOWNLOAD_MONITOR_VERSION, root: text(current.root), intervalMs, downloads: Object.freeze(downloads), activeCount: downloads.filter((item) => item.state === 'active').length, stalledCount: downloads.filter((item) => item.state === 'stalled').length, completedCount: downloads.filter((item) => item.state === 'complete').length, totalBytesPerSecond: downloads.reduce((sum, item) => sum + item.throughputBytesPerSecond, 0), mutation: 'none' });
}

export function createDownloadMonitor({ scan, intervalMs = 5000, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  if (typeof scan !== 'function') throw new TypeError('Download monitor requires a scan function');
  if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new RangeError('Download monitor interval is invalid');
  let previous = null;
  let timer = null;
  async function observe(root) {
    const current = await scan(root);
    const report = compareDownloadSnapshots(previous, current, { intervalMs });
    previous = current;
    return report;
  }
  function start(root, onReport = () => {}) {
    if (timer) throw new Error('Download monitor is already running');
    timer = setIntervalImpl(async () => { try { onReport(await observe(root)); } catch (error) { onReport(Object.freeze({ version: DOWNLOAD_MONITOR_VERSION, state: 'error', reason: error.message, mutation: 'none' })); } }, intervalMs);
    return Object.freeze({ state: 'started', intervalMs });
  }
  function stop() { if (timer) clearIntervalImpl(timer); timer = null; previous = null; return Object.freeze({ state: 'stopped' }); }
  return Object.freeze({ version: DOWNLOAD_MONITOR_VERSION, observe, start, stop });
}
