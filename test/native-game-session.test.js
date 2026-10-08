/**
 * Native game-session tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { buildGameRestorePlan, createGameSessionMonitor, GAME_SESSION_VERSION } from '../native/game-session.js';

const gaming = {
  processes: [
    { pid: 10, name: 'game.exe', foreground: true, role: 'game' },
    { pid: 20, name: 'build', foreground: false, role: 'build', priority: 'normal', ioPriority: 'high' }
  ]
};
const idle = { processes: [{ pid: 20, name: 'build', foreground: false, role: 'build' }] };

describe('native game-session supervisor', () => {
  test('builds restoration only from exact captured priority evidence', () => {
    expect(buildGameRestorePlan()).toMatchObject({ version: GAME_SESSION_VERSION, state: 'review-required', operations: [] });
    expect(() => buildGameRestorePlan(null)).toThrow('array');
    const plan = buildGameRestorePlan([
      { type: 'set-process-priority', pid: 20, value: 'low', previousValue: 'normal', name: 'build' },
      { type: 'set-process-io-priority', pid: 20, value: 'low', previousValue: 'high', name: 'build' },
      { type: 'set-power-profile', pid: 20, value: 'low', previousValue: 'normal' },
      { type: 'set-process-priority', pid: 0, value: 'low', previousValue: 'normal' },
      { type: 'set-process-priority', pid: 20, value: 'low', previousValue: null }
    ]);
    expect(plan).toMatchObject({ state: 'plan-ready', reason: 'captured exact pre-session priority evidence', operations: [{ value: 'normal', previousValue: 'low' }, { value: 'high', previousValue: 'low' }] });
    expect(buildGameRestorePlan([null, { type: 'unknown', pid: 20, previousValue: 'normal' }, { type: 'set-process-priority', pid: 20, value: 'low', previousValue: 'bad' }])).toMatchObject({ state: 'review-required' });
  });

  test('detects transitions, applies approved background budgets, and restores them', async () => {
    const facts = [gaming, gaming, idle];
    const calls = [];
    const events = [];
    const adapter = { collectFacts: jest.fn(async () => facts.shift()), requiresAdmin: () => false, applyAction: jest.fn(async (action, context) => { calls.push({ action, context }); return { ok: true }; }) };
    const monitor = createGameSessionMonitor({ adapter, gameNames: ['game.exe'], backgroundPids: [20, 20, 0], approvedPids: [20], autoApply: true, intervalMs: 1000, now: () => 100, onEvent: async (event) => events.push(event) });
    expect(monitor.version).toBe(GAME_SESSION_VERSION);
    expect(monitor.isRunning()).toBe(false);
    expect((await monitor.collect()).type).toBe('game-started');
    expect((await monitor.collect()).type).toBe('game-continued');
    const stopped = await monitor.collect();
    expect(stopped).toMatchObject({ type: 'game-stopped', state: 'idle', restorePlan: { state: 'plan-ready' }, restoreReport: { applied: expect.any(Array) } });
    expect(events).toHaveLength(3);
    expect(calls).toHaveLength(4);
    expect(calls[0].context).toMatchObject({ targetPid: 20, approved: true, allowProcessStop: false });
    expect(monitor.stop()).toMatchObject({ stopped: false });
    expect(events[1].plan.operations).toHaveLength(2);
  });

  test('runs trigger callbacks and reports idle or unavailable restoration states', async () => {
    const timers = [];
    const errors = [];
    let current = null;
    const monitor = createGameSessionMonitor({ adapter: { collectFacts: async () => current }, gameNames: ['', 2, 'game.exe'], backgroundPids: 'bad', intervalMs: 1000, onError: (error) => errors.push(error), setIntervalImpl: (callback, delay) => { timers.push({ callback, delay }); return 'timer'; }, clearIntervalImpl: (timer) => timers.push({ timer }) });
    expect((await monitor.collect()).type).toBe('idle');
    current = gaming;
    expect((await monitor.collect()).type).toBe('game-started');
    expect(monitor.start()).toMatchObject({ started: true, intervalMs: 1000 });
    expect(monitor.start()).toMatchObject({ started: false });
    timers[0].callback();
    await new Promise((resolve) => setImmediate(resolve));
    expect(monitor.stop()).toMatchObject({ stopped: true, restorationRequired: false });
    expect(timers.at(-1)).toEqual({ timer: 'timer' });
    expect(errors).toEqual([]);
    current = idle;
    expect((await monitor.collect()).type).toBe('game-stopped');
    expect((await monitor.collect()).type).toBe('idle');
    const failing = createGameSessionMonitor({ adapter: { collectFacts: async () => { throw new Error('facts failed'); } }, onError: (error) => errors.push(error), setIntervalImpl: (callback) => { callback(); return 1; }, clearIntervalImpl: () => {} });
    failing.start();
    await new Promise((resolve) => setImmediate(resolve));
    expect(errors.at(-1).message).toBe('facts failed');
    await expect(failing.collect()).rejects.toThrow('facts failed');
    const silent = createGameSessionMonitor({ adapter: { collectFacts: async () => { throw new Error('silent'); } }, setIntervalImpl: (callback) => { callback(); return 2; }, clearIntervalImpl: () => {} });
    silent.start();
    await new Promise((resolve) => setImmediate(resolve));
  });

  test('validates monitor authority, clock, timers, and callbacks', async () => {
    const adapter = { collectFacts: async () => ({}) };
    expect(createGameSessionMonitor({ adapter, gameNames: 'not-an-array' }).version).toBe(GAME_SESSION_VERSION);
    expect(() => createGameSessionMonitor()).toThrow('facts adapter');
    expect(() => createGameSessionMonitor({ adapter, autoApply: true })).toThrow('approved PIDs');
    expect(() => createGameSessionMonitor({ adapter, intervalMs: 999 })).toThrow('interval');
    expect(() => createGameSessionMonitor({ adapter, now: null })).toThrow('clock');
    expect(() => createGameSessionMonitor({ adapter, onEvent: null })).toThrow('callbacks');
    expect(() => createGameSessionMonitor({ adapter, setIntervalImpl: null })).toThrow('timer');
    const invalidClock = createGameSessionMonitor({ adapter, now: () => NaN });
    await expect(invalidClock.collect()).rejects.toThrow('clock must return');
  });
});
