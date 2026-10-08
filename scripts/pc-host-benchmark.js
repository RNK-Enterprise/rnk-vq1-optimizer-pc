/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Read-only host benchmark primitives. This module never applies a system
 * action; it records evidence for a later optimization decision.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import { createCacheCleaner } from '../native/cache-cleaner.js';
import { createCommandRunner } from '../native/command-runner.js';
import { createPlatformAdapter } from '../native/platform.js';

const monotonicNow = () => performance.now();

function finiteSamples(samples) {
  return samples.filter((value) => Number.isFinite(value));
}

function summarize(samples) {
  const values = finiteSamples(samples);
  if (!values.length) return { count: 0, minMs: null, maxMs: null, meanMs: null, varianceMs: null };
  const meanMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  const varianceMs = values.reduce((sum, value) => sum + ((value - meanMs) ** 2), 0) / values.length;
  return {
    count: values.length,
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
    meanMs,
    varianceMs
  };
}

export async function measureOperation(operation, { repetitions = 3, now = monotonicNow } = {}) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) {
    throw new RangeError('repetitions must be between 1 and 10');
  }
  const samplesMs = [];
  let observation = null;
  for (let index = 0; index < repetitions; index += 1) {
    const started = now();
    observation = await operation();
    samplesMs.push(now() - started);
  }
  return { latency: summarize(samplesMs), observation };
}

export async function measureEventLoop({ samples = 16, setImmediateImpl = setImmediate, now = monotonicNow } = {}) {
  if (!Number.isInteger(samples) || samples < 1 || samples > 100) {
    throw new RangeError('event-loop samples must be between 1 and 100');
  }
  const delays = [];
  for (let index = 0; index < samples; index += 1) {
    const started = now();
    await new Promise((resolve) => setImmediateImpl(resolve));
    delays.push(now() - started);
  }
  return { samplesMs: delays, summary: summarize(delays) };
}

export async function measureTemporaryIo({
  fsImpl = fs,
  osImpl = os,
  pathImpl = path,
  now = monotonicNow,
  bytes = 64 * 1024
} = {}) {
  if (!Number.isInteger(bytes) || bytes < 1024 || bytes > 4 * 1024 * 1024) {
    throw new RangeError('temporary I/O bytes must be between 1024 and 4194304');
  }
  const parent = await fsImpl.mkdtemp(pathImpl.join(osImpl.tmpdir(), 'rnk-pc-benchmark-'));
  const target = pathImpl.join(parent, 'io-sample.bin');
  const payload = Buffer.alloc(bytes, 65);
  try {
    const writeStart = now();
    await fsImpl.writeFile(target, payload);
    const writeMs = now() - writeStart;
    const readStart = now();
    const result = await fsImpl.readFile(target);
    const readMs = now() - readStart;
    return {
      bytes,
      verifiedBytes: result.length,
      writeMs,
      readMs,
      writeThroughputMBps: bytes / Math.max(writeMs, 0.001) / 1024 / 1024 * 1000,
      readThroughputMBps: result.length / Math.max(readMs, 0.001) / 1024 / 1024 * 1000
    };
  } finally {
    await fsImpl.rm(parent, { recursive: true, force: true });
  }
}

export async function readPowerState({ platform = process.platform, commandRunner } = {}) {
  if (!commandRunner || typeof commandRunner.run !== 'function') return { available: false, reason: 'command runner unavailable' };
  const command = platform === 'linux'
    ? ['powerprofilesctl', ['get']]
    : platform === 'win32'
      ? ['powercfg.exe', ['/getactivescheme']]
      : null;
  if (!command) return { available: false, reason: `unsupported platform: ${platform}` };
  try {
    const result = await commandRunner.run(command[0], command[1], { timeoutMs: 2500, maxOutputBytes: 2048 });
    return { available: result.code === 0, command: command[0], output: result.code === 0 ? result.stdout.trim() : null };
  } catch (error) {
    return { available: false, command: command[0], reason: error.message };
  }
}

export async function measureCacheReclamation({ cacheCleaner, platform = process.platform } = {}) {
  if (!cacheCleaner || typeof cacheCleaner.preview !== 'function' || typeof cacheCleaner.clean !== 'function') {
    return { available: false, reason: 'cache cleaner unavailable' };
  }
  const preview = await cacheCleaner.preview({ target: 'user-temp', platform, maxAgeHours: 24, maxEntries: 2000 });
  const dryRun = await cacheCleaner.clean(preview, { dryRun: true });
  return {
    available: true,
    target: preview.target,
    roots: preview.roots,
    candidateCount: preview.items.length,
    truncated: preview.truncated,
    dryRun: dryRun.dryRun === true,
    wouldReclaim: dryRun.skipped
  };
}

async function snapshot({ adapter, commandRunner, cacheCleaner, platform, repetitions, eventLoopSamples, now }) {
  const facts = await measureOperation(() => adapter.collectFacts(), { repetitions, now });
  const eventLoop = await measureEventLoop({ samples: eventLoopSamples, now });
  const temporaryIo = await measureOperation(() => measureTemporaryIo({ now }), { repetitions, now });
  const powerState = await readPowerState({ platform, commandRunner });
  const cacheReclamation = await measureCacheReclamation({ cacheCleaner, platform });
  return { facts, eventLoop, temporaryIo, powerState, cacheReclamation };
}

function evidenceDecision(before, after) {
  return {
    evidence: { before, after },
    decision: 'benchmark-only; no system action applied',
    measurableHostResult: { before, after }
  };
}

export async function runHostBenchmark({
  platform = process.platform,
  adapter = createPlatformAdapter({ platform }),
  commandRunner = createCommandRunner(),
  cacheCleaner = createCacheCleaner(),
  repetitions = 3,
  eventLoopSamples = 16,
  now = monotonicNow
} = {}) {
  const before = await snapshot({ adapter, commandRunner, cacheCleaner, platform, repetitions, eventLoopSamples, now });
  const after = await snapshot({ adapter, commandRunner, cacheCleaner, platform, repetitions, eventLoopSamples, now });
  return {
    benchmarkVersion: 1,
    measuredAt: new Date().toISOString(),
    platform,
    appliedSystemActions: [],
    domains: {
      hostFacts: evidenceDecision(before.facts, after.facts),
      scheduling: evidenceDecision(before.eventLoop, after.eventLoop),
      temporaryIo: evidenceDecision(before.temporaryIo, after.temporaryIo),
      powerState: evidenceDecision(before.powerState, after.powerState),
      cacheReclamation: evidenceDecision(before.cacheReclamation, after.cacheReclamation)
    },
    notes: [
      'This benchmark is observational and applies no operating-system action.',
      'Cache reclamation is measured as a dry run; no files are removed.'
    ]
  };
}
