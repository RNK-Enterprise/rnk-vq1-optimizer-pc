/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Cross-platform interface bandwidth evidence from cumulative counters.
 * It never shapes traffic and does not infer per-process ownership.
 */

export const NETWORK_RATE_VERSION = 1;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function bytes(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function interfaces(snapshot) { return Array.isArray(snapshot?.interfaces) ? snapshot.interfaces.filter(record).slice(0, 128) : []; }
function interval(value) { if (!Number.isFinite(value) || value < 1 || value > 24 * 60 * 60 * 1000) throw new RangeError('Network rate interval is out of range'); return value; }

function normalizedRows(snapshot) {
  return interfaces(snapshot).map((item) => ({
    name: text(item.name) || 'unknown',
    receivedBytes: bytes(item.receivedBytes),
    sentBytes: bytes(item.sentBytes),
    state: text(item.state) || 'unknown'
  }));
}

function rate(current, previous, elapsedMs) {
  if (current === null || previous === null) return { bytesPerSecond: null, counterState: 'observation-required' };
  if (current < previous) return { bytesPerSecond: null, counterState: 'counter-reset' };
  return { bytesPerSecond: (current - previous) / (elapsedMs / 1000), counterState: 'measured' };
}

export function compareNetworkRates(previous, current, { intervalMs = 1000 } = {}) {
  if (!record(current)) throw new TypeError('Network rate current snapshot is required');
  if (previous !== null && previous !== undefined && !record(previous)) throw new TypeError('Network rate previous snapshot is invalid');
  const elapsedMs = interval(intervalMs);
  const currentRows = normalizedRows(current);
  const previousRows = new Map(normalizedRows(previous).map((item) => [item.name, item]));
  const rows = currentRows.map((item) => {
    const prior = previousRows.get(item.name) || { receivedBytes: null, sentBytes: null };
    const received = rate(item.receivedBytes, prior.receivedBytes, elapsedMs);
    const sent = rate(item.sentBytes, prior.sentBytes, elapsedMs);
    return Object.freeze({ ...item, receivedBytesPerSecond: received.bytesPerSecond, sentBytesPerSecond: sent.bytesPerSecond, counterState: received.counterState === 'counter-reset' || sent.counterState === 'counter-reset' ? 'counter-reset' : received.counterState === 'measured' && sent.counterState === 'measured' ? 'measured' : 'observation-required' });
  });
  const measured = rows.filter((item) => item.counterState === 'measured');
  const reset = rows.some((item) => item.counterState === 'counter-reset');
  const total = (field) => measured.length > 0 && measured.every((item) => Number.isFinite(item[field])) ? measured.reduce((sum, item) => sum + item[field], 0) : null;
  const state = !rows.length || !previous ? 'observation-required' : reset ? 'counter-reset' : measured.length ? 'rate-ready' : 'observation-required';
  return Object.freeze({ version: NETWORK_RATE_VERSION, state, available: measured.length > 0, intervalMs: elapsedMs, interfaces: Object.freeze(rows), receivedBytesPerSecond: total('receivedBytesPerSecond'), sentBytesPerSecond: total('sentBytesPerSecond'), totalBytesPerSecond: total('receivedBytesPerSecond') === null || total('sentBytesPerSecond') === null ? null : total('receivedBytesPerSecond') + total('sentBytesPerSecond'), perProcessAuthority: 'unavailable-with-interface-counters', mutation: 'none' });
}

export function createNetworkRateMonitor({ collectSample, intervalMs = 5000, now = Date.now, onReport = () => {}, onError = () => {}, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  if (typeof collectSample !== 'function') throw new TypeError('Network rate monitor requires a sample collector');
  const elapsedMs = interval(intervalMs);
  if (typeof now !== 'function' || typeof onReport !== 'function' || typeof onError !== 'function') throw new TypeError('Network rate monitor clock and callbacks must be callable');
  if (typeof setIntervalImpl !== 'function' || typeof clearIntervalImpl !== 'function') throw new TypeError('Network rate monitor timer functions must be callable');
  let previous = null;
  let timer = null;
  let running = false;

  async function collect() {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) throw new TypeError('Network rate monitor clock must return a number');
    const sample = await collectSample();
    const report = Object.freeze({ version: NETWORK_RATE_VERSION, timestamp, rate: compareNetworkRates(previous, sample, { intervalMs: elapsedMs }) });
    previous = sample;
    await onReport(report);
    return report;
  }
  function start() {
    if (running) return Object.freeze({ started: false, reason: 'already-running' });
    running = true;
    timer = setIntervalImpl(() => { collect().catch(onError); }, elapsedMs);
    return Object.freeze({ started: true, intervalMs: elapsedMs });
  }
  function stop() {
    if (!running) return Object.freeze({ stopped: false, reason: 'not-running' });
    clearIntervalImpl(timer);
    timer = null;
    running = false;
    previous = null;
    return Object.freeze({ stopped: true });
  }
  return Object.freeze({ version: NETWORK_RATE_VERSION, intervalMs: elapsedMs, collect, start, stop, isRunning: () => running });
}
