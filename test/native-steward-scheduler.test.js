/**
 * Native daily workstation report scheduler tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { createDailyWorkstationScheduler, STEWARD_SCHEDULER_VERSION } from '../native/steward-scheduler.js';

describe('native daily workstation report scheduler', () => {
  test('delivers once per day, supports force, and controls its trigger', async () => {
    let timestamp = Date.UTC(2026, 0, 1, 12);
    const deliveries = [];
    const timers = [];
    const scheduler = createDailyWorkstationScheduler({
      store: { read: async () => [] },
      now: () => timestamp,
      deliver: async (report) => deliveries.push(report),
      intervalMs: 1000,
      setIntervalImpl: (callback, delay) => { timers.push({ callback, delay }); return 'timer'; },
      clearIntervalImpl: (timer) => timers.push({ timer })
    });
    expect(scheduler.version).toBe(STEWARD_SCHEDULER_VERSION);
    expect(scheduler.isRunning()).toBe(false);
    expect(scheduler.stop()).toMatchObject({ stopped: false });
    expect((await scheduler.run()).delivered).toBe(true);
    expect((await scheduler.run()).reason).toBe('already-delivered');
    expect((await scheduler.run({ force: true })).delivered).toBe(true);
    timestamp += 24 * 60 * 60 * 1000;
    expect((await scheduler.run()).delivered).toBe(true);
    expect(deliveries).toHaveLength(3);
    expect(scheduler.start()).toMatchObject({ started: true, intervalMs: 1000 });
    expect(scheduler.start()).toMatchObject({ started: false });
    timers[0].callback();
    await new Promise((resolve) => setImmediate(resolve));
    expect(scheduler.stop()).toEqual({ stopped: true });
    expect(scheduler.stop()).toMatchObject({ stopped: false });
    expect(timers.at(-1)).toEqual({ timer: 'timer' });
  });

  test('fails closed for invalid dependencies, clock, and delivery failures', async () => {
    const store = { read: async () => [] };
    await expect(createDailyWorkstationScheduler({ store }).run()).resolves.toMatchObject({ delivered: true });
    expect(() => createDailyWorkstationScheduler()).toThrow('history store');
    expect(() => createDailyWorkstationScheduler({ store, deliver: null })).toThrow('delivery callback');
    expect(() => createDailyWorkstationScheduler({ store, onError: null })).toThrow('error callback');
    expect(() => createDailyWorkstationScheduler({ store, now: 1 })).toThrow('clock');
    expect(() => createDailyWorkstationScheduler({ store, setIntervalImpl: null })).toThrow('setInterval');
    expect(() => createDailyWorkstationScheduler({ store, clearIntervalImpl: null })).toThrow('clearInterval');
    expect(() => createDailyWorkstationScheduler({ store, intervalMs: 999 })).toThrow('out of range');
    expect(() => createDailyWorkstationScheduler({ store, intervalMs: 86400001 })).toThrow('out of range');
    const invalidClock = createDailyWorkstationScheduler({ store, now: () => NaN });
    await expect(invalidClock.run()).rejects.toThrow('clock must return a number');
    const errors = [];
    const failing = createDailyWorkstationScheduler({ store: { read: async () => { throw new Error('read failed'); } }, onError: (error) => errors.push(error), setIntervalImpl: (callback) => { callback(); return 1; }, clearIntervalImpl: () => {} });
    failing.start();
    await new Promise((resolve) => setImmediate(resolve));
    expect(errors[0].message).toBe('read failed');
    const defaultError = createDailyWorkstationScheduler({ store: { read: async () => { throw new Error('ignored'); } }, setIntervalImpl: (callback) => { callback(); return 1; }, clearIntervalImpl: () => {} });
    defaultError.start();
    await new Promise((resolve) => setImmediate(resolve));
    const deliveryFailure = createDailyWorkstationScheduler({ store, deliver: async () => { throw new Error('delivery failed'); } });
    await expect(deliveryFailure.run()).rejects.toThrow('delivery failed');
  });
});
