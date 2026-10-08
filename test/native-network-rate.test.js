/**
 * Native network rate tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { compareNetworkRates, createNetworkRateMonitor, NETWORK_RATE_VERSION } from '../native/network-rate.js';

describe('native network rate evidence', () => {
  const first = { interfaces: [{ name: 'eth0', receivedBytes: 1000, sentBytes: 500, state: 'up' }, { name: 'wifi0', receivedBytes: 100, sentBytes: 50 }] };

  test('derives bounded interface rates from cumulative counters', () => {
    const report = compareNetworkRates(first, { interfaces: [{ name: 'eth0', receivedBytes: 3000, sentBytes: 1500, state: 'up' }] }, { intervalMs: 2000 });
    expect(report).toMatchObject({ version: NETWORK_RATE_VERSION, state: 'rate-ready', available: true, receivedBytesPerSecond: 1000, sentBytesPerSecond: 500, totalBytesPerSecond: 1500, perProcessAuthority: 'unavailable-with-interface-counters', mutation: 'none' });
    expect(report.interfaces[0]).toMatchObject({ name: 'eth0', counterState: 'measured', receivedBytesPerSecond: 1000, sentBytesPerSecond: 500 });
    expect(compareNetworkRates(null, first)).toMatchObject({ state: 'observation-required', available: false, receivedBytesPerSecond: null });
    expect(compareNetworkRates(first, { interfaces: [{ name: 'eth0', receivedBytes: 10, sentBytes: 20 }] })).toMatchObject({ state: 'counter-reset', available: false, interfaces: [expect.objectContaining({ counterState: 'counter-reset' })] });
  });

  test('fails closed for missing counters and malformed inputs', () => {
    expect(compareNetworkRates(first, { interfaces: [{ name: 'eth0', receivedBytes: null, sentBytes: 520 }] })).toMatchObject({ state: 'observation-required', available: false, totalBytesPerSecond: null });
    expect(compareNetworkRates(null, { interfaces: [{ receivedBytes: null, sentBytes: null }] })).toMatchObject({ interfaces: [expect.objectContaining({ name: 'unknown' })] });
    expect(compareNetworkRates(first, { interfaces: [] })).toMatchObject({ state: 'observation-required', available: false, interfaces: [] });
    expect(compareNetworkRates(undefined, { interfaces: 'bad' })).toMatchObject({ state: 'observation-required', available: false });
    expect(() => compareNetworkRates(null, null)).toThrow('current snapshot');
    expect(() => compareNetworkRates('bad', first)).toThrow('previous snapshot');
    expect(() => compareNetworkRates(first, first, { intervalMs: 0 })).toThrow('out of range');
    expect(() => compareNetworkRates(first, first, { intervalMs: 24 * 60 * 60 * 1000 + 1 })).toThrow('out of range');
  });

  test('runs trigger-based collection with restart-safe state', async () => {
    const samples = [first, { interfaces: [{ name: 'eth0', receivedBytes: 2000, sentBytes: 700 }] }];
    const reports = [];
    let timerCallback;
    const monitor = createNetworkRateMonitor({
      collectSample: jest.fn(async () => samples.shift()),
      intervalMs: 1000,
      now: () => 10,
      onReport: async (report) => reports.push(report),
      setIntervalImpl: (callback) => { timerCallback = callback; return 'timer'; },
      clearIntervalImpl: jest.fn()
    });
    await expect(monitor.collect()).resolves.toMatchObject({ rate: { state: 'observation-required' } });
    await expect(monitor.collect()).resolves.toMatchObject({ rate: { state: 'rate-ready', receivedBytesPerSecond: 1000 } });
    expect(reports).toHaveLength(2);
    expect(monitor.start()).toEqual({ started: true, intervalMs: 1000 });
    expect(monitor.isRunning()).toBe(true);
    expect(monitor.start()).toEqual({ started: false, reason: 'already-running' });
    timerCallback();
    expect(monitor.stop()).toEqual({ stopped: true });
    expect(monitor.stop()).toEqual({ stopped: false, reason: 'not-running' });
  });

  test('rejects invalid monitor dependencies and reports collection errors', async () => {
    expect(() => createNetworkRateMonitor()).toThrow('sample collector');
    expect(() => createNetworkRateMonitor({ collectSample: async () => ({ interfaces: [] }), intervalMs: 0 })).toThrow('out of range');
    expect(() => createNetworkRateMonitor({ collectSample: async () => ({ interfaces: [] }), now: null })).toThrow('callable');
    expect(() => createNetworkRateMonitor({ collectSample: async () => ({ interfaces: [] }), setIntervalImpl: null })).toThrow('timer functions');
    const defaultMonitor = createNetworkRateMonitor({ collectSample: async () => ({ interfaces: [] }), now: () => 1 });
    await expect(defaultMonitor.collect()).resolves.toMatchObject({ rate: { state: 'observation-required' } });
    const invalidClock = createNetworkRateMonitor({ collectSample: async () => ({ interfaces: [] }), now: () => Number.NaN });
    await expect(invalidClock.collect()).rejects.toThrow('clock');
    const errors = [];
    const monitor = createNetworkRateMonitor({ collectSample: async () => { throw new Error('sample failed'); }, onError: (error) => errors.push(error.message), setIntervalImpl: (callback) => { callback(); return 'timer'; }, clearIntervalImpl: () => {} });
    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual(['sample failed']);
    expect(monitor.stop()).toEqual({ stopped: true });
  });
});
