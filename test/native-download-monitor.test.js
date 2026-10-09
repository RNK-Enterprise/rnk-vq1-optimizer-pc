/**
 * Native download monitor tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { compareDownloadSnapshots, createDownloadMonitor, DOWNLOAD_MONITOR_VERSION } from '../native/download-monitor.js';

const first = { root: '/downloads', entries: [{ path: '/downloads/a.part', name: 'a.part', sizeBytes: 100, incomplete: true }, { path: '/downloads/b.zip', sizeBytes: 500, incomplete: false }] };

describe('native download monitor', () => {
  test('reports active, stalled, complete, and first-observation states with throughput', () => {
    const report = compareDownloadSnapshots({ ...first, entries: [...first.entries, { path: '/downloads/stalled.part', sizeBytes: 4, incomplete: true }, { path: '/downloads/unknown.part', sizeBytes: null, incomplete: true }] }, { ...first, storage: { level: 'critical', freeBytes: 50, targetFreeBytes: 100, belowTargetFreeFloor: true }, entries: [{ path: '/downloads/a.part', sizeBytes: 300, incomplete: true }, { path: '/downloads/stalled.part', sizeBytes: 4, incomplete: true }, { path: '/downloads/c.crdownload', sizeBytes: 1, incomplete: true }, { path: '/downloads/b.zip', sizeBytes: 500, incomplete: false }] }, { intervalMs: 2000 });
    expect(report).toMatchObject({ version: DOWNLOAD_MONITOR_VERSION, root: '/downloads', activeCount: 1, stalledCount: 1, completedCount: 1, totalBytesPerSecond: 100, storage: { level: 'critical', freeBytes: 50, targetFreeBytes: 100, belowTargetFreeFloor: true }, storageRisk: 'download-filling-volume', mutation: 'none' });
    expect(report.downloads).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/downloads/a.part', state: 'active', deltaBytes: 200, throughputBytesPerSecond: 100 })]));
    expect(report.downloads.find((item) => item.path.endsWith('c.crdownload')).state).toBe('incomplete');
    expect(compareDownloadSnapshots(null, { root: '', entries: [{ path: '/a', sizeBytes: null, incomplete: false }] })).toMatchObject({ storage: { level: 'unknown', freeBytes: null }, storageRisk: null });
  });

  test('bounds and validates snapshot inputs', () => {
    expect(() => compareDownloadSnapshots(null, null)).toThrow('current');
    expect(() => compareDownloadSnapshots({}, first, { intervalMs: 0 })).toThrow('interval');
    expect(() => compareDownloadSnapshots('bad', first)).toThrow('previous');
    expect(compareDownloadSnapshots({}, { entries: [] })).toMatchObject({ downloads: [], activeCount: 0 });
  });

  test('runs trigger-based observation and reports scan errors', async () => {
    const snapshots = [first, { ...first, entries: [{ path: '/downloads/a.part', sizeBytes: 200, incomplete: true }] }];
    const scan = jest.fn(async () => snapshots.shift() || first);
    const timer = jest.fn();
    const clear = jest.fn();
    const monitor = createDownloadMonitor({ scan, intervalMs: 50, setIntervalImpl: (callback) => { timer.callback = callback; return 7; }, clearIntervalImpl: clear });
    await expect(monitor.observe('/downloads')).resolves.toMatchObject({ activeCount: 0 });
    await expect(monitor.observe('/downloads')).resolves.toMatchObject({ activeCount: 1 });
    expect(monitor.start('/downloads', jest.fn())).toMatchObject({ state: 'started', intervalMs: 50 });
    expect(() => monitor.start('/downloads')).toThrow('already running');
    expect(monitor.stop()).toMatchObject({ state: 'stopped' });
    expect(monitor.stop()).toMatchObject({ state: 'stopped' });
    expect(clear).toHaveBeenCalledWith(7);
    const failing = createDownloadMonitor({ scan: jest.fn(async () => { throw new Error('scan failed'); }), setIntervalImpl: (callback) => { timer.callback = callback; return 8; }, clearIntervalImpl: clear });
    const onReport = jest.fn();
    failing.start('/downloads', onReport);
    await timer.callback();
    expect(onReport).toHaveBeenCalledWith(expect.objectContaining({ state: 'error', reason: 'scan failed', mutation: 'none' }));
    failing.stop();
    let noCallbackTimer;
    const noCallback = createDownloadMonitor({ scan, setIntervalImpl: (callback) => { noCallbackTimer = callback; return callback; }, clearIntervalImpl: clear });
    noCallback.start('/downloads');
    await noCallbackTimer();
    noCallback.stop();
    expect(() => createDownloadMonitor()).toThrow('scan function');
    expect(() => createDownloadMonitor({ scan, intervalMs: 0 })).toThrow('interval');
  });
});
