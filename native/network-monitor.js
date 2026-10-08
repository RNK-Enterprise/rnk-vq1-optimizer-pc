/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Trigger-based network contention observation. The sampler is supplied by
 * the platform boundary or caller; this module never throttles a socket.
 */

import { buildNetworkContentionPlan } from './network-manager.js';

export const NETWORK_MONITOR_VERSION = 1;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function number(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function validPid(value) { return Number.isInteger(value) && value > 0; }
function active(state) { return state === 'contention-review' || state === 'latency-review'; }
function transition(previous, current) {
  if (previous === null) return active(current) ? 'contention-started' : 'stable';
  if (active(previous) && active(current)) return 'contention-continued';
  if (active(previous) && !active(current)) return 'contention-stopped';
  return active(current) ? 'contention-started' : 'stable';
}

function validateInterval(value) {
  if (!Number.isInteger(value) || value < 1000 || value > 86400000) throw new RangeError('Network monitor interval is out of range');
  return value;
}

function normalizeSample(sample) {
  if (!record(sample)) throw new TypeError('Network monitor sample must be an object');
  return Object.freeze({
    samples: Array.isArray(sample.samples) ? sample.samples.slice(0, 512) : [],
    gamePid: validPid(sample.gamePid) ? sample.gamePid : null,
    latencyMs: number(sample.latencyMs),
    source: typeof sample.source === 'string' && sample.source.trim() ? sample.source.trim() : 'explicit-caller-or-platform-counter'
  });
}

export function createNetworkMonitor({
  collectSample,
  intervalMs = 5000,
  downloadThresholdBytesPerSecond = 1024 * 1024,
  now = Date.now,
  onReport = () => {},
  onError = () => {},
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
} = {}) {
  if (typeof collectSample !== 'function') throw new TypeError('Network monitor requires a sample collector');
  const interval = validateInterval(intervalMs);
  if (!Number.isFinite(downloadThresholdBytesPerSecond) || downloadThresholdBytesPerSecond < 0) throw new RangeError('Network monitor threshold is invalid');
  if (typeof now !== 'function' || typeof onReport !== 'function' || typeof onError !== 'function') throw new TypeError('Network monitor clock and callbacks must be callable');
  if (typeof setIntervalImpl !== 'function' || typeof clearIntervalImpl !== 'function') throw new TypeError('Network monitor timer functions must be callable');
  let previous = null;
  let timer = null;
  let running = false;

  async function collect() {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) throw new TypeError('Network monitor clock must return a number');
    const snapshot = normalizeSample(await collectSample());
    const plan = buildNetworkContentionPlan({ ...snapshot, downloadThresholdBytesPerSecond });
    const eventType = transition(previous, plan.state);
    previous = plan.state;
    const report = Object.freeze({ version: NETWORK_MONITOR_VERSION, timestamp, type: eventType, state: plan.state, snapshot, plan, mutation: 'none' });
    await onReport(report);
    return report;
  }

  function start() {
    if (running) return Object.freeze({ started: false, reason: 'already-running' });
    running = true;
    timer = setIntervalImpl(() => { collect().catch(onError); }, interval);
    return Object.freeze({ started: true, intervalMs: interval });
  }

  function stop() {
    if (!running) return Object.freeze({ stopped: false, reason: 'not-running' });
    clearIntervalImpl(timer);
    timer = null;
    running = false;
    previous = null;
    return Object.freeze({ stopped: true });
  }

  return Object.freeze({ version: NETWORK_MONITOR_VERSION, intervalMs: interval, collect, start, stop, isRunning: () => running });
}
