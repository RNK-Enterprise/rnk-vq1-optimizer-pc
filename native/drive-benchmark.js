/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded read/write evidence against an explicit temporary root. The probe
 * verifies the read length and removes only its own temporary sample.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';

export const DRIVE_BENCHMARK_VERSION = 1;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function clock(value) { return typeof value === 'function' ? value : () => performance.now(); }

export async function benchmarkDrive({ root = os.tmpdir(), bytes = 1024 * 1024, fsImpl = fs, pathImpl = path, now = () => performance.now() } = {}) {
  const targetRoot = text(root);
  if (!targetRoot) throw new TypeError('Drive benchmark requires an explicit root');
  if (!Number.isInteger(bytes) || bytes < 4096 || bytes > 4 * 1024 * 1024) throw new RangeError('Drive benchmark bytes must be between 4096 and 4194304');
  const timer = clock(now);
  const parent = await fsImpl.mkdtemp(pathImpl.join(targetRoot, 'rnk-drive-benchmark-'));
  const target = pathImpl.join(parent, 'io-sample.bin');
  const payload = Buffer.alloc(bytes, 65);
  try {
    const writeStart = timer();
    await fsImpl.writeFile(target, payload);
    const writeMs = Math.max(timer() - writeStart, 0.001);
    const readStart = timer();
    const result = await fsImpl.readFile(target);
    const readMs = Math.max(timer() - readStart, 0.001);
    const verified = result.length === bytes;
    return Object.freeze({ version: DRIVE_BENCHMARK_VERSION, root: targetRoot, bytes, verified, verifiedBytes: result.length, writeMs, readMs, writeThroughputMBps: bytes / writeMs / 1024 / 1024 * 1000, readThroughputMBps: result.length / readMs / 1024 / 1024 * 1000, mutation: 'temporary-sample-only' });
  } finally {
    await fsImpl.rm(parent, { recursive: true, force: true });
  }
}
