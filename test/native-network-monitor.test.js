/**
 * Native network monitor tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { createNetworkMonitor, NETWORK_MONITOR_VERSION } from '../native/network-monitor.js';

const sample = (state) => state === 'contention'
  ? { gamePid: 10, latencyMs: 20, samples: [{ pid: 10, name: 'game', role: 'game', receivedBytesPerSecond: 100 }, { pid: 20, name: 'download', role: 'download', receivedBytesPerSecond: 2_000_000 }] }
  : { gamePid: 10, latencyMs: 20, samples: [{ pid: 10, name: 'game', role: 'game', receivedBytesPerSecond: 100 }] };

function timers() {
  let callback;
  return { set: jest.fn((fn) => { callback = fn; return 7; }), clear: jest.fn(), fire: () => callback?.() };
}

describe('native network monitor', () => {
  test('rejects invalid boundaries', () => {
    expect(() => createNetworkMonitor()).toThrow('sample collector');
    expect(() => createNetworkMonitor({ collectSample: async () => ({}), intervalMs: 999 })).toThrow('interval');
    expect(() => createNetworkMonitor({ collectSample: async () => ({}), downloadThresholdBytesPerSecond: -1 })).toThrow('threshold');
    expect(() => createNetworkMonitor({ collectSample: async () => ({}), now: 1 })).toThrow('callable');
    expect(() => createNetworkMonitor({ collectSample: async () => ({}), setIntervalImpl: 1 })).toThrow('timer');
  });

  test('reports contention transitions and preserves observation-only authority', async () => {
    const queue = [sample('stable'), sample('contention'), sample('contention'), sample('stable')];
    const reports = [];
    const monitor = createNetworkMonitor({ collectSample: async () => queue.shift(), now: () => 1000, onReport: (report) => reports.push(report) });
    expect(monitor.version).toBe(NETWORK_MONITOR_VERSION);
    await expect(monitor.collect()).resolves.toMatchObject({ type: 'stable', state: 'stable', mutation: 'none' });
    await expect(monitor.collect()).resolves.toMatchObject({ type: 'contention-started', state: 'contention-review' });
    await expect(monitor.collect()).resolves.toMatchObject({ type: 'contention-continued', state: 'contention-review' });
    await expect(monitor.collect()).resolves.toMatchObject({ type: 'contention-stopped', state: 'stable' });
    expect(reports).toHaveLength(4);
    expect(reports[1].plan.operations[0]).toMatchObject({ operation: 'review-download-budget', pid: 20 });
    expect(reports[1].snapshot.source).toBe('explicit-caller-or-platform-counter');
  });

  test('reports latency review and rejects malformed collection or clock data', async () => {
    const monitor = createNetworkMonitor({ collectSample: async () => ({ samples: [{ pid: 10, name: 'game', role: 'game', receivedBytesPerSecond: 100 }], latencyMs: 150 }), now: () => 5 });
    await expect(monitor.collect()).resolves.toMatchObject({ type: 'contention-started', state: 'latency-review' });
    let transitionMonitorSample = 0;
    const transitionMonitor = createNetworkMonitor({ collectSample: async () => ({ samples: [{ pid: 10, name: 'game', receivedBytesPerSecond: 100 }], latencyMs: transitionMonitorSample++ ? 150 : 20 }), now: () => 5 });
    await expect(transitionMonitor.collect()).resolves.toMatchObject({ type: 'stable' });
    await expect(transitionMonitor.collect()).resolves.toMatchObject({ type: 'contention-started', state: 'latency-review' });
    const stableMonitor = createNetworkMonitor({ collectSample: async () => sample('stable'), now: () => 5 });
    await stableMonitor.collect();
    await stableMonitor.collect();
    const unavailable = createNetworkMonitor({ collectSample: async () => ({ source: '', latencyMs: 'bad' }), now: () => 5 });
    await expect(unavailable.collect()).resolves.toMatchObject({ snapshot: { samples: [], latencyMs: null, source: 'explicit-caller-or-platform-counter' } });
    const defaults = createNetworkMonitor({ collectSample: async () => ({ ...sample('stable'), source: 'adapter-counter' }), now: () => 5 });
    await defaults.collect();
    const badSample = createNetworkMonitor({ collectSample: async () => null });
    await expect(badSample.collect()).rejects.toThrow('sample');
    const badClock = createNetworkMonitor({ collectSample: async () => ({}), now: () => NaN });
    await expect(badClock.collect()).rejects.toThrow('clock');
    const rejected = createNetworkMonitor({ collectSample: async () => { throw new Error('counter unavailable'); } });
    const onError = jest.fn();
    const clock = timers();
    const running = createNetworkMonitor({ collectSample: async () => { throw new Error('counter unavailable'); }, onError, setIntervalImpl: clock.set, clearIntervalImpl: clock.clear });
    expect(running.isRunning()).toBe(false);
    expect(running.start()).toEqual({ started: true, intervalMs: 5000 });
    expect(running.isRunning()).toBe(true);
    expect(running.start()).toEqual({ started: false, reason: 'already-running' });
    await clock.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'counter unavailable' }));
    expect(running.stop()).toEqual({ stopped: true });
    expect(running.isRunning()).toBe(false);
    expect(running.stop()).toEqual({ stopped: false, reason: 'not-running' });
    expect(rejected).toBeDefined();
    const defaultError = createNetworkMonitor({ collectSample: async () => { throw new Error('ignored'); }, setIntervalImpl: clock.set, clearIntervalImpl: clock.clear });
    defaultError.start();
    await clock.fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    defaultError.stop();
  });
});
