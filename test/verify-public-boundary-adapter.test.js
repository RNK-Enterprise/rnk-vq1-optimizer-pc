/**
 * Public-boundary command adapter tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { isEntrypoint, runIfEntrypoint, runPublicBoundary, setExitCode } from '../scripts/verify-public-boundary.mjs';

describe('public-boundary command adapter', () => {
  test('serializes clean and non-clean scan results', async () => {
    const write = jest.fn();
    await expect(runPublicBoundary({ scan: async () => ({ state: 'clean', matches: [] }), write })).resolves.toBe(0);
    expect(write).toHaveBeenCalledWith('{"state":"clean","matches":[]}\n');
    await expect(runPublicBoundary({ scan: async () => ({ state: 'forbidden', matches: ['x'] }), write })).resolves.toBe(1);
    expect(write).toHaveBeenLastCalledWith('{"state":"forbidden","matches":["x"]}\n');
  });

  test('reports scan failures and gates entrypoint execution', async () => {
    const errorWrite = jest.fn();
    await expect(runPublicBoundary({ scan: async () => { throw new Error('scan failed'); }, errorWrite })).resolves.toBe(1);
    expect(errorWrite).toHaveBeenCalledWith('scan failed\n');
    const run = jest.fn().mockResolvedValue(7);
    await expect(runIfEntrypoint({ entrypoint: false, run })).resolves.toBe(0);
    expect(run).not.toHaveBeenCalled();
    await expect(runIfEntrypoint({ entrypoint: true, run })).resolves.toBe(7);
    expect(run).toHaveBeenCalledTimes(1);
    const target = {};
    expect(setExitCode(0, target)).toBe(0);
    expect(target).toEqual({});
    expect(setExitCode(1, target)).toBe(1);
    expect(target).toEqual({ exitCode: 1 });
  });

  test('covers default output and execution targets', async () => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(runPublicBoundary(undefined, { defaultScan: async () => ({ state: 'clean' }) })).resolves.toBe(0);
    await expect(runPublicBoundary({ scan: async () => ({ state: 'clean' }) })).resolves.toBe(0);
    await expect(runPublicBoundary({ scan: async () => { throw new Error('default failure'); } })).resolves.toBe(1);
    await expect(runIfEntrypoint({ entrypoint: true, runOptions: { scan: async () => ({ state: 'clean' }) } })).resolves.toBe(0);
    await expect(runIfEntrypoint()).resolves.toBe(0);
    expect(setExitCode(0)).toBe(0);
    expect(isEntrypoint('file:///tmp/adapter.mjs', '')).toBe(false);
    expect(stdout).toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith('default failure\n');
    stdout.mockRestore();
    stderr.mockRestore();
  });
});
