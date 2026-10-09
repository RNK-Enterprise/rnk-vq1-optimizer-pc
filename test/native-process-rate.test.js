/**
 * Native process-resource rate tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { compareProcessResourceSnapshots, createProcessResourceMonitor, PROCESS_RATE_VERSION } from '../native/process-rate.js';

const first = {
  processes: [
    { pid: 10, name: 'builder', path: '/opt/builder', role: 'build', cpuSeconds: 2, ioReadBytes: 100, ioWriteBytes: 200, memoryBytes: 1000, gpuMemoryBytes: 50 },
    { pid: 20, name: 'worker', path: '', cpuSeconds: 4, ioReadBytes: 400, ioWriteBytes: 500, memoryBytes: 2000 }
  ]
};

describe('native process-resource rate evidence', () => {
  test('derives CPU, I/O, memory, and GPU evidence from matching samples', () => {
    const report = compareProcessResourceSnapshots(first, {
      processes: [
        { pid: 10, name: ' builder ', path: '/opt/builder', role: 'BUILD', cpuSeconds: 3, ioReadBytes: 300, ioWriteBytes: 600, memoryBytes: 1200, gpuMemoryBytes: 70 },
        { pid: 20, name: 'worker', path: '', cpuSeconds: 4.5, ioReadBytes: 500, ioWriteBytes: 700, memoryBytes: 1900 },
        null,
        { pid: 0, name: 'invalid' },
        { pid: 'bad', name: 'invalid' }
      ]
    }, { intervalMs: 2000 });
    expect(report).toMatchObject({ version: PROCESS_RATE_VERSION, available: true, intervalMs: 2000, measuredCount: 2, resetCount: 0, state: 'rate-ready', mutation: 'none' });
    expect(report.processes[0]).toMatchObject({ pid: 10, name: 'builder', role: 'build', cpuPercent: 50, ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 200, ioBytesPerSecond: 300, memoryBytes: 1200, memoryDeltaBytes: 200, gpuMemoryBytes: 70, state: 'measured' });
    expect(report.processes[1]).toMatchObject({ pid: 20, cpuPercent: 25, ioReadBytesPerSecond: 50, ioWriteBytesPerSecond: 100, ioBytesPerSecond: 150, memoryDeltaBytes: -100, gpuMemoryBytes: null, state: 'measured' });
  });

  test('fails closed for first samples, identity changes, resets, and missing fields', () => {
    const initial = compareProcessResourceSnapshots(null, first);
    expect(initial).toMatchObject({ state: 'observation-required', available: false });
    expect(initial.processes[0]).toMatchObject({ state: 'observation-required', memoryDeltaBytes: null });
    const changed = compareProcessResourceSnapshots(first, { processes: [{ pid: 10, name: 'other', path: '/opt/other', cpuSeconds: 3, ioReadBytes: 300, ioWriteBytes: 600, memoryBytes: 1200 }] });
    expect(changed).toMatchObject({ state: 'observation-required', available: false, processes: [expect.objectContaining({ state: 'identity-changed', memoryDeltaBytes: null })] });
    const reset = compareProcessResourceSnapshots(first, { processes: [{ pid: 10, name: 'builder', path: '/opt/builder', cpuSeconds: 1, ioReadBytes: 50, ioWriteBytes: 600, memoryBytes: 1200 }] });
    expect(reset).toMatchObject({ state: 'counter-reset', available: false, resetCount: 1, processes: [expect.objectContaining({ state: 'counter-reset', cpuPercent: null, ioReadBytesPerSecond: null })] });
    const missing = compareProcessResourceSnapshots({ processes: [{ pid: 10, name: 'builder', path: '/opt/builder' }] }, { processes: [{ pid: 10, name: 'builder', path: '/opt/builder', memoryBytes: 'bad' }] });
    expect(missing).toMatchObject({ state: 'observation-required', available: false, processes: [expect.objectContaining({ state: 'observation-required', memoryBytes: null, memoryDeltaBytes: null })] });
    const newProcess = compareProcessResourceSnapshots(first, { processes: [{ pid: 30, name: '', role: '', path: '' }] });
    expect(newProcess).toMatchObject({ state: 'observation-required', available: false, processes: [expect.objectContaining({ state: 'observation-required', name: 'unknown', role: 'unknown' })] });
  });

  test('bounds rows and rejects malformed arguments', () => {
    const many = { processes: Array.from({ length: 3 }, (_, index) => ({ pid: index + 1, name: `p${index}`, cpuSeconds: 1, ioReadBytes: 1, ioWriteBytes: 1 })) };
    expect(compareProcessResourceSnapshots(null, many, { maxEntries: 2 }).processes).toHaveLength(2);
    expect(compareProcessResourceSnapshots(undefined, { processes: 'bad' })).toMatchObject({ state: 'observation-required', processes: [] });
    expect(() => compareProcessResourceSnapshots(null, null)).toThrow('current snapshot');
    expect(() => compareProcessResourceSnapshots('bad', first)).toThrow('previous snapshot');
    expect(() => compareProcessResourceSnapshots(null, first, { maxEntries: 0 })).toThrow('maxEntries');
    expect(() => compareProcessResourceSnapshots(null, first, { maxEntries: 513 })).toThrow('maxEntries');
    expect(() => compareProcessResourceSnapshots(null, first, { maxEntries: 1.5 })).toThrow('maxEntries');
    expect(() => compareProcessResourceSnapshots(null, first, { intervalMs: Number.NaN })).toThrow('interval');
    expect(() => compareProcessResourceSnapshots(null, first, { intervalMs: 0 })).toThrow('interval');
    expect(() => compareProcessResourceSnapshots(null, first, { intervalMs: 24 * 60 * 60 * 1000 + 1 })).toThrow('interval');
  });

  test('runs trigger-based collection and resets identity after stop', async () => {
    const samples = [first, { processes: [{ pid: 10, name: 'builder', path: '/opt/builder', cpuSeconds: 3, ioReadBytes: 300, ioWriteBytes: 600 }] }, { processes: [] }, { processes: [] }];
    const reports = [];
    let timerCallback;
    const clearIntervalImpl = jest.fn();
    const monitor = createProcessResourceMonitor({
      collectSample: jest.fn(async () => samples.shift()),
      intervalMs: 1000,
      now: () => 10,
      onReport: async (report) => reports.push(report),
      setIntervalImpl: (callback) => { timerCallback = callback; return 'timer'; },
      clearIntervalImpl
    });
    await expect(monitor.collect()).resolves.toMatchObject({ rate: { state: 'observation-required' } });
    await expect(monitor.collect()).resolves.toMatchObject({ rate: { state: 'rate-ready', processes: [expect.objectContaining({ cpuPercent: 100 })] } });
    expect(reports).toHaveLength(2);
    expect(monitor.start()).toEqual({ started: true, intervalMs: 1000 });
    expect(monitor.isRunning()).toBe(true);
    expect(monitor.start()).toEqual({ started: false, reason: 'already-running' });
    timerCallback();
    expect(monitor.stop()).toEqual({ stopped: true });
    expect(clearIntervalImpl).toHaveBeenCalledWith('timer');
    expect(monitor.stop()).toEqual({ stopped: false, reason: 'not-running' });
    await expect(monitor.collect()).resolves.toMatchObject({ rate: { state: 'observation-required' } });
  });

  test('validates monitor dependencies and forwards asynchronous failures', async () => {
    expect(() => createProcessResourceMonitor()).toThrow('sample collector');
    expect(() => createProcessResourceMonitor({ collectSample: async () => ({ processes: [] }), intervalMs: 0 })).toThrow('out of range');
    expect(() => createProcessResourceMonitor({ collectSample: async () => ({ processes: [] }), now: null })).toThrow('callable');
    expect(() => createProcessResourceMonitor({ collectSample: async () => ({ processes: [] }), onReport: null })).toThrow('callable');
    expect(() => createProcessResourceMonitor({ collectSample: async () => ({ processes: [] }), onError: null })).toThrow('callable');
    expect(() => createProcessResourceMonitor({ collectSample: async () => ({ processes: [] }), setIntervalImpl: null })).toThrow('timer functions');
    expect(() => createProcessResourceMonitor({ collectSample: async () => ({ processes: [] }), clearIntervalImpl: null })).toThrow('timer functions');
    const invalidClock = createProcessResourceMonitor({ collectSample: async () => ({ processes: [] }), now: () => Number.NaN });
    await expect(invalidClock.collect()).rejects.toThrow('clock');
    const errors = [];
    let callback;
    const monitor = createProcessResourceMonitor({ collectSample: async () => { throw new Error('sample failed'); }, onError: (error) => errors.push(error.message), setIntervalImpl: (value) => { callback = value; return 'timer'; }, clearIntervalImpl: () => {} });
    monitor.start();
    callback();
    await new Promise((resolve) => setImmediate(resolve));
    expect(errors).toEqual(['sample failed']);
    expect(monitor.stop()).toEqual({ stopped: true });
  });

  test('uses no-op callbacks when callers omit optional monitor handlers', async () => {
    const monitor = createProcessResourceMonitor({ collectSample: async () => ({ processes: [] }), now: () => 1 });
    await expect(monitor.collect()).resolves.toMatchObject({ rate: { state: 'observation-required' } });
  });

  test('uses the default error callback for trigger failures', async () => {
    let callback;
    const monitor = createProcessResourceMonitor({
      collectSample: async () => { throw new Error('default failure'); },
      setIntervalImpl: (value) => { callback = value; return 'timer'; },
      clearIntervalImpl: () => {}
    });
    monitor.start();
    callback();
    await new Promise((resolve) => setImmediate(resolve));
    expect(monitor.stop()).toEqual({ stopped: true });
  });
});
