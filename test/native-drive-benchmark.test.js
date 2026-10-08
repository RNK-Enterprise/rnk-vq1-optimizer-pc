/**
 * Native drive benchmark tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { benchmarkDrive, DRIVE_BENCHMARK_VERSION } from '../native/drive-benchmark.js';

describe('native drive benchmark', () => {
  test('writes, reads, verifies, and cleans one bounded sample', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-drive-test-'));
    const values = [0, 10, 20];
    const result = await benchmarkDrive({ root, bytes: 4096, now: () => values.shift() });
    expect(result).toMatchObject({ version: DRIVE_BENCHMARK_VERSION, root, bytes: 4096, verified: true, verifiedBytes: 4096, mutation: 'temporary-sample-only' });
    expect(result.writeThroughputMBps).toBeGreaterThan(0);
    await expect(fs.readdir(root)).resolves.toEqual([]);
    await fs.rm(root, { recursive: true, force: true });
  });

  test('validates root and byte bounds and reports a read mismatch', async () => {
    await expect(benchmarkDrive({ root: '', bytes: 4096 })).rejects.toThrow('explicit root');
    await expect(benchmarkDrive({ root: '/tmp', bytes: 4095 })).rejects.toThrow('bytes');
    await expect(benchmarkDrive({ root: '/tmp', bytes: 4 * 1024 * 1024 + 1 })).rejects.toThrow('bytes');
    const fsImpl = { mkdtemp: jest.fn(async () => '/tmp/rnk-bench'), writeFile: jest.fn(), readFile: jest.fn(async () => Buffer.alloc(4)), rm: jest.fn() };
    const result = await benchmarkDrive({ root: '/tmp', bytes: 4096, fsImpl, pathImpl: path, now: 1 });
    expect(result).toMatchObject({ verified: false, verifiedBytes: 4 });
    expect(fsImpl.rm).toHaveBeenCalledWith('/tmp/rnk-bench', { recursive: true, force: true });
    await expect(benchmarkDrive({ bytes: 4096, fsImpl })).resolves.toMatchObject({ version: DRIVE_BENCHMARK_VERSION, root: expect.any(String) });
    await expect(benchmarkDrive()).resolves.toMatchObject({ version: DRIVE_BENCHMARK_VERSION, verified: true });
    await expect(benchmarkDrive({ root: '/tmp', bytes: 4096, fsImpl: undefined, pathImpl: undefined, now: undefined })).resolves.toMatchObject({ version: DRIVE_BENCHMARK_VERSION, verified: true });
    await expect(benchmarkDrive({ root: '/tmp', bytes: 4096, fsImpl: { ...fsImpl, mkdtemp: jest.fn().mockRejectedValue(new Error('denied')) } })).rejects.toThrow('denied');
  });
});
