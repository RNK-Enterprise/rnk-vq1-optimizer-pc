/**
 * PC host benchmark command adapter tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { isEntrypoint, parseBenchmarkArgs, runHostBenchmarkCli, runIfEntrypoint, setExitCode } from '../scripts/pc-host-benchmark.mjs';

describe('PC host benchmark command adapter', () => {
  test('parses default and explicit benchmark options', () => {
    expect(parseBenchmarkArgs()).toEqual({ json: false, rounds: 3, eventLoopSamples: 16 });
    expect(parseBenchmarkArgs(['--json', '--rounds=4', '--event-loop-samples=8'])).toEqual({ json: true, rounds: 4, eventLoopSamples: 8 });
  });

  test('formats JSON and human-readable benchmark results', async () => {
    const result = { platform: 'linux', appliedSystemActions: [], domains: { storage: { decision: 'benchmark-only' } } };
    const jsonWrite = jest.fn();
    await expect(runHostBenchmarkCli({ argv: ['--json'], benchmark: async (options) => { expect(options).toEqual({ repetitions: 3, eventLoopSamples: 16 }); return result; }, write: jsonWrite })).resolves.toBe(0);
    expect(jsonWrite).toHaveBeenCalledWith(`${JSON.stringify(result)}\n`);
    const textWrite = jest.fn();
    await expect(runHostBenchmarkCli({ argv: [], benchmark: async () => ({ ...result, appliedSystemActions: [{ type: 'none' }], domains: { storage: { decision: 'review' }, memory: { decision: 'observe' } } }), write: textWrite })).resolves.toBe(0);
    expect(textWrite.mock.calls.flat()).toEqual(expect.arrayContaining(['PC host benchmark (linux)\n', 'Applied system actions: 1\n', 'storage: review\n', 'memory: observe\n']));
  });

  test('reports benchmark failure and entrypoint boundaries', async () => {
    const errorWrite = jest.fn();
    await expect(runHostBenchmarkCli({ benchmark: async () => { throw new Error('benchmark failed'); }, errorWrite })).resolves.toBe(1);
    expect(errorWrite).toHaveBeenCalledWith('benchmark failed\n');
    const run = jest.fn().mockResolvedValue(4);
    await expect(runIfEntrypoint({ entrypoint: false, run })).resolves.toBe(0);
    await expect(runIfEntrypoint({ entrypoint: true, run })).resolves.toBe(4);
    await expect(runIfEntrypoint()).resolves.toBe(0);
    const target = {};
    expect(setExitCode(0, target)).toBe(0);
    expect(setExitCode(1, target)).toBe(1);
    expect(setExitCode(0)).toBe(0);
    expect(target).toEqual({ exitCode: 1 });
    expect(isEntrypoint('file:///tmp/benchmark.mjs', '')).toBe(false);
  });

  test('covers default command writers and default benchmark runner', async () => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(runHostBenchmarkCli({ argv: ['--json'], benchmark: async () => ({ ok: true }) })).resolves.toBe(0);
    await expect(runHostBenchmarkCli({ benchmark: async () => { throw new Error('default failure'); } })).resolves.toBe(1);
    await expect(runHostBenchmarkCli()).resolves.toBe(0);
    await expect(runIfEntrypoint({ entrypoint: true, run: async () => 0 })).resolves.toBe(0);
    expect(stdout).toHaveBeenCalledWith('{"ok":true}\n');
    expect(stderr).toHaveBeenCalledWith('default failure\n');
    stdout.mockRestore();
    stderr.mockRestore();
  }, 30000);
});
