/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Cross-platform observation loop for workstation-steward reports. It records
 * facts and reports; it does not apply plans or stop processes.
 */

import { runWorkstationStewardEngine } from '../pc/engines/workstation-steward/engine.js';

const TRIGGERS = Object.freeze(['system.facts.request', 'workload.changed', 'health.interval']);

function requireAdapter(adapter) { if (!adapter || typeof adapter.collectFacts !== 'function') throw new TypeError('Steward monitor requires a facts adapter'); return adapter; }
function requireStore(store) { if (!store || typeof store.append !== 'function') throw new TypeError('Steward monitor requires a history store'); return store; }
function requireClock(now) { if (typeof now !== 'function') throw new TypeError('Steward monitor clock must be a function'); return now; }
function requireInterval(value) { if (!Number.isInteger(value) || value < 1000 || value > 86400000) throw new RangeError('Steward monitor interval out of range'); return value; }
function requireTrigger(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported steward monitor trigger: ${trigger || 'unknown'}`); return trigger; }

export function createStewardMonitor({ adapter, store, intervalMs = 900000, trigger = 'health.interval', now = Date.now, onReport = () => {}, onError = () => {}, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  requireAdapter(adapter);
  requireStore(store);
  const interval = requireInterval(intervalMs);
  requireTrigger(trigger);
  requireClock(now);
  if (typeof onReport !== 'function' || typeof onError !== 'function') throw new TypeError('Steward monitor callbacks must be functions');
  if (typeof setIntervalImpl !== 'function' || typeof clearIntervalImpl !== 'function') throw new TypeError('Steward monitor timer functions must be callable');
  let timer = null;
  let running = false;

  async function collect() {
    const collectedAt = now();
    if (!Number.isFinite(collectedAt)) throw new TypeError('Steward monitor clock must return a number');
    const facts = await adapter.collectFacts();
    const report = runWorkstationStewardEngine({ ...(facts || {}), engine: facts?.engine || 'system-facts' }, { trigger, now: () => collectedAt });
    const entry = await store.append({ id: `steward-${collectedAt}`, event: 'report', timestamp: collectedAt, platform: report.platform, reversible: false, facts, report });
    await onReport(report, entry);
    return Object.freeze({ report, entry });
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
    return Object.freeze({ stopped: true });
  }

  return Object.freeze({ intervalMs: interval, trigger, collect, start, stop, isRunning: () => running });
}
