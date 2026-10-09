/**
 * Release-provenance command adapter tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { isEntrypoint, runIfEntrypoint, runReleaseProvenance, setExitCode } from '../scripts/verify-release-provenance.mjs';

describe('release-provenance command adapter', () => {
  test('serializes successful and failed verification results', () => {
    const write = jest.fn();
    expect(runReleaseProvenance({ verify: () => ({ tag: 'v3.1.1', signed: true }), write })).toBe(0);
    expect(write).toHaveBeenCalledWith('{"tag":"v3.1.1","signed":true}\n');
    const errorWrite = jest.fn();
    expect(runReleaseProvenance({ verify: () => { throw new Error('unsigned'); }, errorWrite })).toBe(1);
    expect(errorWrite).toHaveBeenCalledWith('unsigned\n');
  });

  test('covers entrypoint and default target boundaries', () => {
    const run = jest.fn().mockReturnValue(3);
    expect(runIfEntrypoint({ entrypoint: false, run })).toBe(0);
    expect(runIfEntrypoint({ entrypoint: true, run })).toBe(3);
    expect(runIfEntrypoint()).toBe(0);
    const target = {};
    expect(setExitCode(0, target)).toBe(0);
    expect(setExitCode(1, target)).toBe(1);
    expect(target).toEqual({ exitCode: 1 });
    expect(setExitCode(0)).toBe(0);
    expect(isEntrypoint('file:///tmp/adapter.mjs', '')).toBe(false);
  });

  test('covers default verification output and runner', () => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(runReleaseProvenance({ verify: () => ({ ok: true }) })).toBe(0);
    expect(runReleaseProvenance({ verify: () => { throw new Error('default failure'); } })).toBe(1);
    expect(runIfEntrypoint({ entrypoint: true })).toBe(1);
    expect(stdout).toHaveBeenCalledWith('{"ok":true}\n');
    expect(stderr).toHaveBeenCalledWith('default failure\n');
    stdout.mockRestore();
    stderr.mockRestore();
  });
});
