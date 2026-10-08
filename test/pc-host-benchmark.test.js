/**
 * PC host benchmark tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  measureCacheReclamation,
  measureEventLoop,
  measureOperation,
  measureTemporaryIo,
  readPowerState,
  runHostBenchmark
} from '../scripts/pc-host-benchmark.js';

describe('PC host benchmark', () => {
  test('measures bounded operations and rejects invalid repetition counts', async () => {
    let clock = 0;
    const result = await measureOperation(async () => 'facts', { repetitions: 2, now: () => (clock += 2) });
    expect(result.observation).toBe('facts');
    expect(result.latency).toEqual(expect.objectContaining({ count: 2, meanMs: 2 }));
    await expect(measureOperation(async () => null, { repetitions: 0 })).rejects.toThrow('between 1 and 10');
    await expect(measureOperation(async () => null, { repetitions: 11 })).rejects.toThrow('between 1 and 10');
    await expect(measureOperation(async () => null)).resolves.toEqual(expect.objectContaining({ observation: null }));
  });

  test('measures event-loop delay with an injected scheduler', async () => {
    let clock = 0;
    const result = await measureEventLoop({
      samples: 2,
      setImmediateImpl: (callback) => callback(),
      now: () => (clock += 1)
    });
    expect(result.samplesMs).toEqual([1, 1]);
    const empty = await measureEventLoop({ samples: 1, setImmediateImpl: (callback) => callback(), now: () => Number.NaN });
    expect(empty.summary.count).toBe(0);
    await expect(measureEventLoop({ samples: 1 })).resolves.toEqual(expect.objectContaining({ summary: expect.any(Object) }));
    await expect(measureEventLoop()).resolves.toEqual(expect.objectContaining({ summary: expect.any(Object) }));
    await expect(measureEventLoop({ samples: 0 })).rejects.toThrow('between 1 and 100');
    await expect(measureEventLoop({ samples: 101 })).rejects.toThrow('between 1 and 100');
  });

  test('measures temporary write and read throughput and bounds payload size', async () => {
    let clock = 0;
    const result = await measureTemporaryIo({
      osImpl: { tmpdir: () => os.tmpdir() },
      pathImpl: path,
      fsImpl: fs,
      bytes: 1024,
      now: () => (clock += 1)
    });
    expect(result).toEqual(expect.objectContaining({ bytes: 1024, verifiedBytes: 1024, writeMs: 1, readMs: 1 }));
    await expect(measureTemporaryIo({ bytes: 512 })).rejects.toThrow('between 1024');
    await expect(measureTemporaryIo({ bytes: 5 * 1024 * 1024 })).rejects.toThrow('between 1024');
    await expect(measureTemporaryIo()).resolves.toEqual(expect.objectContaining({ bytes: 64 * 1024 }));
    expect(await readPowerState()).toEqual(expect.objectContaining({ available: false }));
  });

  test('reads supported and unsupported power-state surfaces fail closed', async () => {
    expect(await readPowerState({ platform: 'darwin', commandRunner: { run: jest.fn() } })).toEqual(expect.objectContaining({ available: false }));
    expect(await readPowerState({ platform: 'linux', commandRunner: null })).toEqual(expect.objectContaining({ available: false }));
    const runner = { run: jest.fn().mockResolvedValue({ code: 0, stdout: 'balanced\n' }) };
    expect(await readPowerState({ platform: 'linux', commandRunner: runner })).toEqual({ available: true, command: 'powerprofilesctl', output: 'balanced' });
    runner.run.mockRejectedValue(new Error('not installed'));
    expect(await readPowerState({ platform: 'win32', commandRunner: runner })).toEqual(expect.objectContaining({ available: false, command: 'powercfg.exe', reason: 'not installed' }));
    runner.run.mockResolvedValue({ code: 1, stdout: 'failed' });
    expect(await readPowerState({ platform: 'linux', commandRunner: runner })).toEqual({ available: false, command: 'powerprofilesctl', output: null });
  });

  test('previews cache reclamation without deleting files', async () => {
    expect(await measureCacheReclamation({ platform: 'linux', cacheCleaner: null })).toEqual(expect.objectContaining({ available: false }));
    const cacheCleaner = {
      preview: jest.fn().mockResolvedValue({ target: 'user-temp', roots: ['/tmp/rnk'], items: [{ path: '/tmp/rnk/a' }], truncated: false }),
      clean: jest.fn().mockResolvedValue({ dryRun: true, skipped: 1 })
    };
    expect(await measureCacheReclamation({ platform: 'linux', cacheCleaner })).toEqual({
      available: true,
      target: 'user-temp',
      roots: ['/tmp/rnk'],
      candidateCount: 1,
      truncated: false,
      dryRun: true,
      wouldReclaim: 1
    });
    expect(await measureCacheReclamation({ cacheCleaner })).toEqual(expect.objectContaining({ target: 'user-temp' }));
    expect(await measureCacheReclamation()).toEqual(expect.objectContaining({ available: false }));
  });

  test('returns before/after evidence and explicitly reports no applied actions', async () => {
    const adapter = { collectFacts: jest.fn().mockResolvedValue({ cpu: { cores: 4 } }) };
    const runner = { run: jest.fn().mockResolvedValue({ code: 0, stdout: 'balanced' }) };
    const cacheCleaner = {
      preview: jest.fn().mockResolvedValue({ target: 'user-temp', roots: [], items: [], truncated: false }),
      clean: jest.fn().mockResolvedValue({ dryRun: true, skipped: 0 })
    };
    const result = await runHostBenchmark({
      platform: 'linux',
      adapter,
      commandRunner: runner,
      cacheCleaner,
      repetitions: 1,
      eventLoopSamples: 1
    });
    expect(result.appliedSystemActions).toEqual([]);
    expect(result.domains.hostFacts.evidence.before.observation).toEqual({ cpu: { cores: 4 } });
    expect(result.domains.cacheReclamation.decision).toContain('no system action');
    expect(adapter.collectFacts).toHaveBeenCalledTimes(2);
  });

  test('constructs safe defaults for the unsupported local platform', async () => {
    const result = await runHostBenchmark({ platform: 'darwin', repetitions: 1, eventLoopSamples: 1 });
    expect(result.platform).toBe('darwin');
    expect(result.domains.powerState.evidence.before.available).toBe(false);
    const defaultResult = await runHostBenchmark();
    expect(defaultResult.appliedSystemActions).toEqual([]);
  });
});
