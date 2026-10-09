/**
 * Native network manager tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { buildNetworkContentionPlan, summarizeNetworkUsage, NETWORK_MANAGER_VERSION } from '../native/network-manager.js';

describe('native network manager', () => {
  test('summarizes explicit per-process rates without claiming hidden counters', () => {
    const usage = summarizeNetworkUsage([{ pid: 2, name: 'download', role: 'download', receivedBytesPerSecond: 3, sentBytesPerSecond: 4 }, { pid: 3, name: 'explicit', connections: 5 }, { pid: 0, name: '', receivedBytesPerSecond: -1, sentBytesPerSecond: 'bad' }, null], { maxEntries: 2, connections: [{ pid: 2 }, { pid: 2 }, { pid: 0 }] });
    expect(usage).toMatchObject({ version: NETWORK_MANAGER_VERSION, available: true, perProcessAuthority: 'explicit-caller-or-platform-counter', mutation: 'none' });
    expect(usage.perProcess[0]).toMatchObject({ pid: 2, name: 'download', totalBytesPerSecond: 7, connections: 2 });
    expect(summarizeNetworkUsage([])).toMatchObject({ available: false, perProcess: [], perProcessAuthority: 'unavailable' });
    expect(summarizeNetworkUsage()).toMatchObject({ available: false, perProcess: [] });
    expect(summarizeNetworkUsage([{ pid: 2, receivedBytesPerSecond: 1 }], { connections: null })).toMatchObject({ perProcess: [{ connections: 0 }] });
    expect(() => summarizeNetworkUsage(null)).toThrow('array');
    expect(() => summarizeNetworkUsage([], { maxEntries: 0 })).toThrow('limit');
  });

  test('builds gaming/download contention review and latency review', () => {
    const contention = buildNetworkContentionPlan({ gamePid: 10, latencyMs: 120, samples: [{ pid: 10, name: 'game', role: 'game', receivedBytesPerSecond: 10 }, { pid: 20, name: 'download', role: 'download', receivedBytesPerSecond: 2 * 1024 * 1024 }] });
    expect(contention).toMatchObject({ state: 'contention-review', game: { pid: 10 }, heavyBackground: [{ pid: 20 }], operations: [{ operation: 'review-download-budget', mutation: 'none', requiresApproval: true }] });
    expect(buildNetworkContentionPlan({ samples: [{ pid: 1, name: 'app', receivedBytesPerSecond: 1 }], latencyMs: 100 })).toMatchObject({ state: 'latency-review', heavyBackground: [] });
    expect(buildNetworkContentionPlan()).toMatchObject({ state: 'observation-required', latencyMs: null });
    expect(buildNetworkContentionPlan({ samples: [{ pid: 1, receivedBytesPerSecond: 1 }], gamePid: 999 })).toMatchObject({ state: 'stable', game: null });
    expect(() => buildNetworkContentionPlan({ downloadThresholdBytesPerSecond: -1 })).toThrow('threshold');
  });
});
