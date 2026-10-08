/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Trigger-based daily report delivery. The caller owns scheduling, storage,
 * and presentation; this module only reduces retained facts and delivers one
 * report per UTC day unless explicitly forced.
 */

import { buildDailyWorkstationReport } from './workstation-report.js';

export const STEWARD_SCHEDULER_VERSION = 1;
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

function requireStore(store) {
  if (!store || typeof store.read !== 'function') throw new TypeError('Steward scheduler requires a history store');
  return store;
}

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`Steward scheduler ${name} must be a function`);
  return value;
}

function requireInterval(value) {
  if (!Number.isInteger(value) || value < MIN_INTERVAL_MS || value > MAX_INTERVAL_MS) throw new RangeError('Steward scheduler interval is out of range');
  return value;
}

function dayKey(timestamp) { return new Date(timestamp).toISOString().slice(0, 10); }

export function createDailyWorkstationScheduler({
  store,
  deliver = async () => {},
  onError = () => {},
  now = Date.now,
  intervalMs = 15 * 60 * 1000,
  windowMs,
  maxSamples,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
} = {}) {
  requireStore(store);
  requireFunction(deliver, 'delivery callback');
  requireFunction(onError, 'error callback');
  requireFunction(now, 'clock');
  requireFunction(setIntervalImpl, 'setInterval');
  requireFunction(clearIntervalImpl, 'clearInterval');
  const interval = requireInterval(intervalMs);
  let timer = null;
  let running = false;
  let deliveredDay = null;

  async function run({ force = false } = {}) {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) throw new TypeError('Steward scheduler clock must return a number');
    const entries = await store.read();
    const report = buildDailyWorkstationReport(entries, { now: () => timestamp, windowMs, maxSamples });
    const currentDay = dayKey(timestamp);
    if (!force && deliveredDay === currentDay) return Object.freeze({ delivered: false, reason: 'already-delivered', report });
    await deliver(report);
    deliveredDay = currentDay;
    return Object.freeze({ delivered: true, report });
  }

  function start() {
    if (running) return Object.freeze({ started: false, reason: 'already-running' });
    running = true;
    timer = setIntervalImpl(() => { run().catch(onError); }, interval);
    return Object.freeze({ started: true, intervalMs: interval });
  }

  function stop() {
    if (!running) return Object.freeze({ stopped: false, reason: 'not-running' });
    clearIntervalImpl(timer);
    timer = null;
    running = false;
    return Object.freeze({ stopped: true });
  }

  return Object.freeze({ version: STEWARD_SCHEDULER_VERSION, intervalMs: interval, run, start, stop, isRunning: () => running });
}
