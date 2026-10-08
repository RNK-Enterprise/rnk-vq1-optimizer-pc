/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Cross-platform workstation steward runtime. It owns one observation loop
 * and one daily-report loop in the same process; the caller owns process
 * lifetime, service installation, and presentation.
 */

import { createStewardMonitor } from './steward-monitor.js';
import { createDailyWorkstationScheduler } from './steward-scheduler.js';

export const STEWARD_DAEMON_VERSION = 1;

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`Steward daemon ${name} must be a function`);
  return value;
}
function requireStore(store) {
  if (!store || typeof store.append !== 'function' || typeof store.read !== 'function') throw new TypeError('Steward daemon requires an append/read history store');
  return store;
}
function requireAdapter(adapter) {
  if (!adapter || typeof adapter.collectFacts !== 'function') throw new TypeError('Steward daemon requires a facts adapter');
  return adapter;
}
function requireInterval(value, name) {
  if (!Number.isInteger(value) || value < 1000 || value > 86400000) throw new RangeError(`Steward daemon ${name} interval is out of range`);
  return value;
}

export function createStewardDaemon({
  adapter,
  store,
  observationIntervalMs = 900000,
  reportIntervalMs = 900000,
  now = Date.now,
  onObservation = async () => {},
  deliver = async () => {},
  onError = () => {},
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
} = {}) {
  requireAdapter(adapter);
  requireStore(store);
  requireFunction(now, 'clock');
  requireFunction(onObservation, 'observation callback');
  requireFunction(deliver, 'report callback');
  requireFunction(onError, 'error callback');
  requireFunction(setIntervalImpl, 'setInterval');
  requireFunction(clearIntervalImpl, 'clearInterval');
  const observationInterval = requireInterval(observationIntervalMs, 'observation');
  const reportInterval = requireInterval(reportIntervalMs, 'report');
  const monitor = createStewardMonitor({ adapter, store, intervalMs: observationInterval, now, onReport: onObservation, onError, setIntervalImpl, clearIntervalImpl });
  const scheduler = createDailyWorkstationScheduler({ store, intervalMs: reportInterval, now, deliver, onError, setIntervalImpl, clearIntervalImpl });
  let running = false;

  async function collect({ forceReport = false } = {}) {
    const observation = await monitor.collect();
    const dailyReport = await scheduler.run({ force: forceReport });
    return Object.freeze({ observation, dailyReport });
  }
  function start() {
    if (running) return Object.freeze({ started: false, reason: 'already-running' });
    monitor.start();
    scheduler.start();
    running = true;
    return Object.freeze({ started: true, observationIntervalMs: observationInterval, reportIntervalMs: reportInterval });
  }
  function stop() {
    if (!running) return Object.freeze({ stopped: false, reason: 'not-running' });
    scheduler.stop();
    monitor.stop();
    running = false;
    return Object.freeze({ stopped: true });
  }
  return Object.freeze({ version: STEWARD_DAEMON_VERSION, observationIntervalMs: observationInterval, reportIntervalMs: reportInterval, collect, start, stop, isRunning: () => running });
}
