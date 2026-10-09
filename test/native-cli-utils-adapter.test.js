/**
 * Native CLI utility adapter tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { approvals, downloadGuardFromArgs, historyStoreFromArgs, jsonOption, listOption, mediaLibraryFromArgs, numberOption, parseArgs, protectedRootsStoreFromArgs, requireOption, storageGuardFromArgs, storageOptionsFromArgs, storagePolicyFromArgs, textListOption } from '../native/cli-utils.mjs';

describe('native CLI utility adapter', () => {
  test('parses options and validates bounded values', () => {
    expect(parseArgs()).toEqual({ _: [] });
    expect(parseArgs(['facts', '--inline=value', '--next', 'value', '--flag', '--last'])).toEqual({ _: ['facts'], inline: 'value', next: 'value', flag: true, last: true });
    expect(parseArgs(['--empty='])).toEqual({ _: [], empty: '' });
    expect(() => parseArgs(['--=bad'])).toThrow('empty option');
    expect(numberOption({}, 'missing', 4)).toBe(4);
    expect(numberOption({ count: '3' }, 'count', 0)).toBe(3);
    expect(() => numberOption({ count: 'bad' }, 'count', 0)).toThrow('numeric');
    expect(approvals(true)).toBe(true);
    expect(approvals(' one, two, ')).toEqual(['one', 'two']);
    expect(approvals('')).toEqual([]);
    expect(approvals()).toEqual([]);
    expect(requireOption({ path: '/tmp' }, 'path')).toBe('/tmp');
    expect(() => requireOption({}, 'path')).toThrow('required');
    expect(jsonOption({ value: '{"ok":true}' }, 'value')).toEqual({ ok: true });
    expect(() => jsonOption({ value: 'bad' }, 'value')).toThrow('valid JSON');
    expect(listOption({ pids: '4,5,4' }, 'pids')).toEqual([4, 5]);
    expect(listOption({}, 'pids')).toEqual([]);
    expect(() => listOption({ pids: true }, 'pids')).toThrow('comma-separated');
    expect(() => listOption({ pids: '0' }, 'pids')).toThrow('invalid PID');
    expect(textListOption({ names: 'a, b, a' }, 'names')).toEqual(['a', 'b']);
    expect(textListOption({}, 'names')).toEqual([]);
    expect(() => textListOption({ names: true }, 'names')).toThrow('comma-separated');
  });

  test('builds bounded stores, guards, and storage policy options', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-cli-utils-'));
    const history = historyStoreFromArgs({ path: path.join(tempRoot, 'history.jsonl'), 'max-entries': '4' });
    expect(history.maxEntries).toBe(4);
    expect(storagePolicyFromArgs({ 'warning-percent': '30', 'critical-percent': '15', 'emergency-percent': '8', 'target-free-gb': '6', 'min-age-hours': '48', 'max-entries': '64' })).toMatchObject({ warningPercent: 30, criticalPercent: 15, emergencyPercent: 8, targetFreeBytes: 6 * 1024 ** 3, minAgeHours: 48, maxEntries: 64 });
    expect(storageGuardFromArgs({})).toBeDefined();
    expect(protectedRootsStoreFromArgs({ 'protected-store': path.join(tempRoot, 'protected.json') })).toBeDefined();
    expect(downloadGuardFromArgs({ 'hash-files': true })).toBeDefined();
    expect(downloadGuardFromArgs({})).toBeDefined();
    expect(mediaLibraryFromArgs({ 'state-path': path.join(tempRoot, 'media.json') })).toBeDefined();

    await expect(storageOptionsFromArgs({ enable: 'user-temp,package-cache', 'protected-root': '/projects, /models', 'abandoned-root': '/old-runtime', 'allow-unsafe': true, 'allow-admin': true })).resolves.toMatchObject({ enabledCategories: ['user-temp', 'package-cache'], protectedRoots: ['/projects', '/models'], abandonedRuntimeRoots: ['/old-runtime'], allowUnsafeCategories: true, allowAdmin: true });
    await expect(storageOptionsFromArgs({ 'protected-store': path.join(tempRoot, 'missing.json') })).resolves.toMatchObject({ protectedRoots: [] });
    await expect(storageOptionsFromArgs({ enable: true })).rejects.toThrow('comma-separated');
    await fs.writeFile(path.join(tempRoot, 'invalid.json'), '{bad', 'utf8');
    await expect(storageOptionsFromArgs({ 'protected-store': path.join(tempRoot, 'invalid.json') })).rejects.toThrow();
  });
});
