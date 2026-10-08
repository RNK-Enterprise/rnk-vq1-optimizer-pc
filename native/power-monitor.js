/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Trigger-based power-profile supervision. Recommendations are derived from
 * bounded facts; profile application remains explicit and approval-gated.
 */

import { applyPowerProfile, previewPowerProfile, recommendPowerProfile } from './power-manager.js';

export const POWER_MONITOR_VERSION = 1;

function requireAdapter(adapter) { if (!adapter || typeof adapter.collectFacts !== 'function' || typeof adapter.applyAction !== 'function') throw new TypeError('Power monitor requires a platform adapter'); return adapter; }
function interval(value) { if (!Number.isInteger(value) || value < 1000 || value > 86400000) throw new RangeError('Power monitor interval is out of range'); return value; }
function transition(previous, current) { if (previous === null) return 'profile-observed'; return previous === current ? 'profile-continued' : 'profile-changed'; }

export function createPowerMonitor({
  adapter,
  platform = process.platform,
  intervalMs = 300000,
  autoApply = false,
  approved = false,
  allowAdmin = false,
  now = Date.now,
  onReport = () => {},
  onError = () => {},
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
} = {}) {
  requireAdapter(adapter);
  const cadence = interval(intervalMs);
  if (autoApply === true && approved !== true) throw new Error('Automatic power application requires approval');
  if (typeof now !== 'function' || typeof onReport !== 'function' || typeof onError !== 'function') throw new TypeError('Power monitor clock and callbacks must be callable');
  if (typeof setIntervalImpl !== 'function' || typeof clearIntervalImpl !== 'function') throw new TypeError('Power monitor timer functions must be callable');
  let previous = null;
  let timer = null;
  let running = false;

  async function collect() {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) throw new TypeError('Power monitor clock must return a number');
    const facts = await adapter.collectFacts();
    const recommendation = recommendPowerProfile(facts || {});
    const plan = previewPowerProfile(recommendation.profile, { platform, facts });
    const report = await applyPowerProfile(plan, { adapter, approved, allowAdmin, dryRun: autoApply !== true });
    const event = Object.freeze({ version: POWER_MONITOR_VERSION, timestamp, type: transition(previous, recommendation.profile), profile: recommendation.profile, recommendation, plan, report, facts, mutation: report.applied === true ? 'applied' : 'none' });
    previous = recommendation.profile;
    await onReport(event);
    return event;
  }

  function start() {
    if (running) return Object.freeze({ started: false, reason: 'already-running' });
    running = true;
    timer = setIntervalImpl(() => { collect().catch(onError); }, cadence);
    return Object.freeze({ started: true, intervalMs: cadence });
  }

  function stop() {
    if (!running) return Object.freeze({ stopped: false, reason: 'not-running' });
    clearIntervalImpl(timer);
    timer = null;
    running = false;
    previous = null;
    return Object.freeze({ stopped: true });
  }

  return Object.freeze({ version: POWER_MONITOR_VERSION, intervalMs: cadence, collect, start, stop, isRunning: () => running });
}
