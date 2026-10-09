/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Cross-platform network usage reduction. Interface telemetry is collected by
 * the facts layer; per-process rates are accepted only as explicit evidence.
 */

export const NETWORK_MANAGER_VERSION = 1;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function number(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function validPid(value) { return Number.isInteger(value) && value > 0; }
function connectionCounts(connections) {
  if (!Array.isArray(connections)) return new Map();
  return connections.reduce((counts, item) => {
    if (validPid(item?.pid)) counts.set(item.pid, (counts.get(item.pid) || 0) + 1);
    return counts;
  }, new Map());
}

export function summarizeNetworkUsage(samples = [], { maxEntries = 128, connections = [] } = {}) {
  if (!Array.isArray(samples)) throw new TypeError('Network samples must be an array');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 512) throw new RangeError('Network sample limit is out of range');
  const observedConnections = connectionCounts(connections);
  const usage = samples.filter(record).map((item) => {
    const receivedBytesPerSecond = number(item.receivedBytesPerSecond);
    const sentBytesPerSecond = number(item.sentBytesPerSecond);
    const pidValue = validPid(item.pid) ? item.pid : null;
    const explicitConnections = Number.isInteger(item.connections) && item.connections >= 0 ? item.connections : null;
    return Object.freeze({ pid: pidValue, name: text(item.name) || 'unknown', role: text(item.role)?.toLowerCase() || 'unknown', receivedBytesPerSecond, sentBytesPerSecond, totalBytesPerSecond: (receivedBytesPerSecond || 0) + (sentBytesPerSecond || 0), connections: explicitConnections ?? (pidValue === null ? null : observedConnections.get(pidValue) || 0) });
  }).sort((left, right) => right.totalBytesPerSecond - left.totalBytesPerSecond).slice(0, maxEntries);
  return Object.freeze({ version: NETWORK_MANAGER_VERSION, available: usage.length > 0, perProcess: Object.freeze(usage), perProcessAuthority: usage.length > 0 ? 'explicit-caller-or-platform-counter' : 'unavailable', mutation: 'none' });
}

export function buildNetworkContentionPlan({ samples = [], connections = [], gamePid = null, latencyMs = null, downloadThresholdBytesPerSecond = 1024 * 1024 } = {}) {
  const usage = summarizeNetworkUsage(samples, { connections });
  if (!Number.isFinite(downloadThresholdBytesPerSecond) || downloadThresholdBytesPerSecond < 0) throw new RangeError('Network download threshold is invalid');
  const game = validPid(gamePid) ? usage.perProcess.find((item) => item.pid === gamePid) || null : null;
  const heavyBackground = usage.perProcess.filter((item) => item.pid !== gamePid && (item.role === 'download' || item.totalBytesPerSecond >= downloadThresholdBytesPerSecond));
  const highLatency = Number.isFinite(latencyMs) && latencyMs >= 100;
  const state = !usage.available ? 'observation-required' : game && heavyBackground.length ? 'contention-review' : highLatency ? 'latency-review' : 'stable';
  const operations = state === 'contention-review' ? heavyBackground.map((item) => Object.freeze({ operation: 'review-download-budget', pid: item.pid, name: item.name, requiresApproval: true, mutation: 'none', reason: 'background network workload competes with foreground game' })) : [];
  return Object.freeze({ version: NETWORK_MANAGER_VERSION, state, latencyMs: Number.isFinite(latencyMs) ? latencyMs : null, game, heavyBackground: Object.freeze(heavyBackground), operations: Object.freeze(operations), usage, unsupportedAuthority: 'network-throttle-requires-platform-approved-control' });
}
