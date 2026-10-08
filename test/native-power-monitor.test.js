/**
 * Native power monitor tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { createPowerMonitor, POWER_MONITOR_VERSION } from '../native/power-monitor.js';

function timers() {
  let callback;
  return { set: jest.fn((fn) => { callback = fn; return 3; }), clear: jest.fn(), fire: () => callback?.() };
}

const facts = (profile) => profile === 'gaming'
  ? { game: { detected: true }, thermals: { maxTemperatureC: 70 } }
  : { battery: { batteries: [{ status: 'charging' }] }, thermals: { maxTemperatureC: 70 } };

describe('native power monitor', () => {
  test('rejects unsafe construction and emits profile transitions', async () => {
    expect(() => createPowerMonitor()).toThrow('platform adapter');
    const adapter = { collectFacts: jest.fn(async () => facts('default')), applyAction: jest.fn(async () => ({ ok: true })) };
    expect(() => createPowerMonitor({ adapter, intervalMs: 999 })).toThrow('interval');
    expect(() => createPowerMonitor({ adapter, autoApply: true })).toThrow('approval');
    expect(() => createPowerMonitor({ adapter, now: 1 })).toThrow('callable');
    expect(() => createPowerMonitor({ adapter, setIntervalImpl: 1 })).toThrow('timer');
    const queue = [facts('default'), facts('gaming'), facts('gaming')];
    const reports = [];
    const monitor = createPowerMonitor({ adapter: { ...adapter, collectFacts: async () => queue.shift() }, platform: 'win32', onReport: (event) => reports.push(event), now: () => 100 });
    expect(monitor.version).toBe(POWER_MONITOR_VERSION);
    await expect(monitor.collect()).resolves.toMatchObject({ type: 'profile-observed', profile: 'developer', report: { state: 'approval-required' }, mutation: 'none' });
    await expect(monitor.collect()).resolves.toMatchObject({ type: 'profile-changed', profile: 'gaming' });
    await expect(monitor.collect()).resolves.toMatchObject({ type: 'profile-continued', profile: 'gaming' });
    expect(reports).toHaveLength(3);
  });

  test('supports approved application, unsupported platforms, errors, and lifecycle', async () => {
    const adapter = { collectFacts: jest.fn(async () => facts('gaming')), applyAction: jest.fn(async () => ({ ok: true })) };
    const applied = createPowerMonitor({ adapter, platform: 'linux', autoApply: true, approved: true, allowAdmin: true, now: () => 1 });
    await expect(applied.collect()).resolves.toMatchObject({ report: { state: 'applied', applied: true }, mutation: 'applied' });
    expect(adapter.applyAction).toHaveBeenCalledWith({ type: 'set-power-profile', value: 'performance' }, { approved: true, allowAdmin: true });
    const unsupported = createPowerMonitor({ adapter, platform: 'darwin' });
    await expect(unsupported.collect()).resolves.toMatchObject({ report: { state: 'approval-required', applied: false }, plan: { state: 'unsupported-platform' } });
    const nullFacts = createPowerMonitor({ adapter: { collectFacts: async () => null, applyAction: adapter.applyAction } });
    await expect(nullFacts.collect()).resolves.toMatchObject({ profile: 'balanced' });
    const badClock = createPowerMonitor({ adapter, now: () => NaN });
    await expect(badClock.collect()).rejects.toThrow('clock');
    const errorMonitor = createPowerMonitor({ adapter: { collectFacts: async () => { throw new Error('facts missing'); }, applyAction: adapter.applyAction } });
    await expect(errorMonitor.collect()).rejects.toThrow('facts missing');
    const clock = timers();
    const onError = jest.fn();
    const running = createPowerMonitor({ adapter: { collectFacts: async () => { throw new Error('poll failed'); }, applyAction: adapter.applyAction }, onError, setIntervalImpl: clock.set, clearIntervalImpl: clock.clear });
    expect(running.isRunning()).toBe(false);
    expect(running.start()).toEqual({ started: true, intervalMs: 300000 });
    expect(running.start()).toEqual({ started: false, reason: 'already-running' });
    await clock.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'poll failed' }));
    expect(running.stop()).toEqual({ stopped: true });
    expect(running.stop()).toEqual({ stopped: false, reason: 'not-running' });
    const defaultError = createPowerMonitor({ adapter: { collectFacts: async () => { throw new Error('ignored'); }, applyAction: adapter.applyAction }, setIntervalImpl: clock.set, clearIntervalImpl: clock.clear });
    defaultError.start();
    await clock.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    defaultError.stop();
  });
});
