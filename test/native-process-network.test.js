/**
 * Native per-process network evidence tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { collectProcessNetworkTelemetry, parseProcessNetworkTelemetry, PROCESS_NETWORK_VERSION } from '../native/process-network.js';

describe('native process network evidence', () => {
  test('parses bounded trace rows and rejects ambiguous rows', () => {
    const trace = parseProcessNetworkTelemetry([
      'Refreshing:',
      'PID USER PROGRAM DEV SENT RECEIVED',
      '42 odinn /usr/bin/codex eth0 1.5 2.5',
      '/usr/bin/node/43/1000\t3\t4',
      '/123/1000\t1\t1',
      '44 user program 5 6',
      'broken/identity\t3\t4',
      'unknown TCP'
    ].join('\n'));
    expect(trace).toMatchObject({ version: PROCESS_NETWORK_VERSION, available: true, source: 'nethogs' });
    expect(trace.processes).toEqual(expect.arrayContaining([expect.objectContaining({ pid: 42, name: '/usr/bin/codex', sentBytesPerSecond: 1536, receivedBytesPerSecond: 2560 }), expect.objectContaining({ pid: 43, name: '/usr/bin/node', sentBytesPerSecond: 3072, receivedBytesPerSecond: 4096 })]));
    expect(parseProcessNetworkTelemetry('')).toMatchObject({ available: false, processes: [], truncated: false });
    expect(parseProcessNetworkTelemetry('not-a-process\tbad\tbad')).toMatchObject({ available: false, processes: [] });
  });

  test('bounds large traces and reports platform/tool boundaries', async () => {
    const rows = Array.from({ length: 513 }, (_, index) => `/bin/tool-${index}/${index + 1}/1000\t1\t2`).join('\n');
    expect(parseProcessNetworkTelemetry(rows).truncated).toBe(true);
    const runner = { run: jest.fn(async () => ({ code: 0, stdout: '/bin/codex/7/1000\t1\t2' })) };
    await expect(collectProcessNetworkTelemetry({ platform: 'linux', commandRunner: runner })).resolves.toMatchObject({ available: true, processes: [{ pid: 7 }] });
    expect(runner.run).toHaveBeenCalledWith('nethogs', ['-t', '-c', '1', '-d', '1', '-v', '0'], expect.any(Object));
    await expect(collectProcessNetworkTelemetry({ platform: 'win32', commandRunner: runner })).resolves.toMatchObject({ available: false, source: expect.stringContaining('unavailable') });
    await expect(collectProcessNetworkTelemetry({ platform: 'linux' })).resolves.toMatchObject({ available: false, source: 'command runner unavailable' });
    await expect(collectProcessNetworkTelemetry()).resolves.toMatchObject({ available: false, source: expect.any(String) });
    await expect(collectProcessNetworkTelemetry({ platform: 'linux', commandRunner: { run: jest.fn(async () => ({ code: 1, stderr: 'permission denied' })) } })).resolves.toMatchObject({ available: false, source: 'permission denied' });
    await expect(collectProcessNetworkTelemetry({ platform: 'linux', commandRunner: { run: jest.fn(async () => ({ code: 1 })) } })).resolves.toMatchObject({ available: false, source: 'nethogs command failed' });
    await expect(collectProcessNetworkTelemetry({ platform: 'linux', commandRunner: { run: jest.fn().mockRejectedValue(new Error('missing nethogs')) } })).resolves.toMatchObject({ available: false, source: 'missing nethogs' });
  });
});
