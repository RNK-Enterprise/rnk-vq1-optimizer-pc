/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Trigger-based cross-platform gaming-session supervision. Detection uses
 * explicit process evidence and optional exact names. Changes require opt-in
 * approved PIDs; restoration uses only captured priority evidence.
 */

import { applyWorkloadPolicy, previewWorkloadPolicy } from './workload-governor.js';

export const GAME_SESSION_VERSION = 1;
const PRIORITY_ACTIONS = new Set(['set-process-priority', 'set-process-io-priority']);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function validPid(value) { return Number.isInteger(value) && value > 0; }
function observedPriority(value) { return ['low', 'normal', 'high'].includes(value) ? value : null; }
function list(value, limit = 32) { return Array.isArray(value) ? value.filter((item) => text(item)).map((item) => item.trim()).slice(0, limit) : []; }
function requireAdapter(adapter) { if (!adapter || typeof adapter.collectFacts !== 'function') throw new TypeError('Game session requires a facts adapter'); return adapter; }
function approved(value) { return value === true || (Array.isArray(value) && value.length > 0); }
function transition(previous, current) {
  if (previous === null) return current ? 'game-started' : 'idle';
  if (previous === current) return current ? 'game-continued' : 'idle';
  return current ? 'game-started' : 'game-stopped';
}

function restoreOperation(operation) {
  if (!record(operation) || !PRIORITY_ACTIONS.has(operation.type)) return null;
  const previous = observedPriority(operation.previousValue);
  if (!previous || !validPid(operation.pid)) return null;
  return Object.freeze({ ...operation, value: previous, previousValue: observedPriority(operation.value), reason: 'restore exact pre-session priority evidence' });
}

export function buildGameRestorePlan(appliedOperations = []) {
  if (!Array.isArray(appliedOperations)) throw new TypeError('Game restore operations must be an array');
  const operations = appliedOperations.slice(0, 256).map(restoreOperation).filter(Boolean);
  return Object.freeze({
    version: GAME_SESSION_VERSION,
    state: operations.length ? 'plan-ready' : 'review-required',
    operations: Object.freeze(operations),
    requiresApproval: true,
    reason: operations.length ? 'captured exact pre-session priority evidence' : 'pre-session priority evidence is unavailable'
  });
}

export function createGameSessionMonitor({
  adapter,
  gameNames = [],
  backgroundPids = [],
  processPriority = 'low',
  ioPriority = 'low',
  intervalMs = 10000,
  autoApply = false,
  approvedPids = [],
  allowAdmin = false,
  now = Date.now,
  onEvent = () => {},
  onError = () => {},
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
} = {}) {
  requireAdapter(adapter);
  if (autoApply === true && !approved(approvedPids)) throw new Error('Automatic game-session application requires approved PIDs');
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 86400000) throw new RangeError('Game session monitor interval is out of range');
  if (typeof now !== 'function' || typeof onEvent !== 'function' || typeof onError !== 'function') throw new TypeError('Game session clock and callbacks must be callable');
  if (typeof setIntervalImpl !== 'function' || typeof clearIntervalImpl !== 'function') throw new TypeError('Game session timer functions must be callable');
  const names = list(gameNames);
  const pids = Array.isArray(backgroundPids) ? [...new Set(backgroundPids.filter(validPid))].slice(0, 128) : [];
  let previous = null;
  let session = null;
  let timer = null;
  let running = false;

  async function collect() {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) throw new TypeError('Game session clock must return a number');
    const facts = await adapter.collectFacts();
    const plan = previewWorkloadPolicy(facts || {}, { mode: 'gaming-build', gameNames: names, backgroundPids: pids, processPriority, ioPriority });
    const detected = plan.game.detected === true;
    const eventType = transition(previous, detected);
    let report = null;
    let restorePlan = null;
    let restoreReport = null;
    if (eventType === 'game-started') {
      session = autoApply ? { startedAt: timestamp, applied: [] } : null;
      if (autoApply) {
        report = await applyWorkloadPolicy(plan, { adapter, approvedPids, allowAdmin, dryRun: false });
        session.applied = report.applied.map((entry) => entry.operation);
      }
    } else if (eventType === 'game-stopped') {
      restorePlan = buildGameRestorePlan(session?.applied || []);
      if (autoApply && restorePlan.operations.length) restoreReport = await applyWorkloadPolicy(restorePlan, { adapter, approvedPids, allowAdmin, dryRun: false });
      session = null;
    }
    previous = detected;
    const event = Object.freeze({ version: GAME_SESSION_VERSION, timestamp, type: eventType, state: detected ? 'gaming' : 'idle', game: plan.game, plan, report, restorePlan, restoreReport });
    await onEvent(event);
    return event;
  }

  function start() {
    if (running) return Object.freeze({ started: false, reason: 'already-running' });
    running = true;
    timer = setIntervalImpl(() => { collect().catch(onError); }, intervalMs);
    return Object.freeze({ started: true, intervalMs });
  }

  function stop() {
    if (!running) return Object.freeze({ stopped: false, reason: 'not-running' });
    clearIntervalImpl(timer);
    timer = null;
    running = false;
    return Object.freeze({ stopped: true, restorationRequired: Boolean(session) });
  }

  return Object.freeze({ version: GAME_SESSION_VERSION, intervalMs, collect, start, stop, isRunning: () => running });
}
