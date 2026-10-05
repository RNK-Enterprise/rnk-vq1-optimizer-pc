/**
 * Native cache cleaner tests.
 * Copyright © 2025 Asgard Innovations / RNK™
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createCacheCleaner, defaultCacheRoots } from '../native/cache-cleaner.js';

async function olden(file, timestamp) {
  await fs.utimes(file, timestamp / 1000, timestamp / 1000);
}

describe('native cache cleaner', () => {
  let root;
  let parent;
  let now;

  beforeEach(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-cache-'));
    root = path.join(parent, 'rnk-vortex-optimizer');
    await fs.mkdir(root);
    now = Date.parse('2030-01-02T00:00:00.000Z');
  });

  afterEach(async () => {
    await fs.rm(parent, { recursive: true, force: true });
  });

  test('resolves only known platform roots', () => {
    const env = { HOME: '/home/tester', LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' };
    expect(defaultCacheRoots({ platform: 'linux', env, osImpl: { tmpdir: () => '/tmp' } })['user-temp']).toEqual(['/tmp/rnk-vortex-optimizer']);
    expect(defaultCacheRoots({ platform: 'linux', env, osImpl: { tmpdir: () => '/tmp' } })['shader-cache']).toEqual([
      '/home/tester/.cache/mesa_shader_cache', '/home/tester/.cache/nvidia/GLCache'
    ]);
    expect(defaultCacheRoots({ platform: 'win32', env, osImpl: { tmpdir: () => '/tmp' } })['shader-cache']).toHaveLength(3);
    expect(defaultCacheRoots({ platform: 'darwin', env, osImpl: { tmpdir: () => null } })['user-temp']).toEqual([]);
  });

  test('previews old files, directories, nested entries, symlinks, and truncation', async () => {
    const oldFile = path.join(root, 'old.log');
    const oldDir = path.join(root, 'old-dir');
    const nested = path.join(oldDir, 'nested.tmp');
    const recentDir = path.join(root, 'recent-dir');
    const recentNested = path.join(recentDir, 'old-under-recent.tmp');
    const link = path.join(root, 'link.tmp');
    await fs.writeFile(oldFile, 'old');
    await fs.mkdir(oldDir);
    await fs.writeFile(nested, 'nested');
    await fs.mkdir(recentDir);
    await fs.writeFile(recentNested, 'nested');
    await fs.symlink(oldFile, link);
    await olden(oldFile, now - 10 * 60 * 60 * 1000);
    await olden(oldDir, now - 10 * 60 * 60 * 1000);
    await olden(nested, now - 10 * 60 * 60 * 1000);
    await olden(recentNested, now - 10 * 60 * 60 * 1000);
    const cleaner = createCacheCleaner({ osImpl: { tmpdir: () => path.dirname(root) }, env: {}, now: () => now });
    const preview = await cleaner.preview({ target: 'user-temp', maxAgeHours: 1, maxEntries: 3 });
    expect(preview.roots).toEqual([path.resolve(root)]);
    expect(preview.items).toHaveLength(3);
    expect(preview.truncated).toBe(true);
    expect(preview.items.every((item) => item.path !== link)).toBe(true);
    expect(cleaner.rootsFor('unknown', 'linux')).toEqual([]);
    await expect(cleaner.preview({ maxAgeHours: 0 })).rejects.toThrow('between 1');
    await expect(cleaner.preview({ maxEntries: 0 })).rejects.toThrow('between 1');
  });

  test('requires approval, supports dry run, removes only approved items, and refuses unsafe entries', async () => {
    const oldFile = path.join(root, 'remove.log');
    const oldDir = path.join(root, 'remove-dir');
    const nested = path.join(oldDir, 'nested.tmp');
    const outside = path.join(path.dirname(root), 'outside.tmp');
    const link = path.join(root, 'link.tmp');
    await fs.writeFile(oldFile, 'old');
    await fs.mkdir(oldDir);
    await fs.writeFile(nested, 'nested');
    await fs.writeFile(outside, 'outside');
    await fs.symlink(oldFile, link);
    const cleaner = createCacheCleaner({ osImpl: { tmpdir: () => path.dirname(root) }, env: {}, now: () => now });
    const preview = await cleaner.preview({ maxAgeHours: 1 });
    await expect(cleaner.clean(preview, { dryRun: false })).rejects.toThrow('explicit approval');
    expect(await cleaner.clean(preview)).toEqual({ dryRun: true, removed: [], skipped: preview.items.length });

    const result = await cleaner.clean({
      ...preview,
      items: [...preview.items,
        { path: outside, kind: 'file', sizeBytes: 1, modifiedAt: new Date(now).toISOString() },
        { path: link, kind: 'file', sizeBytes: 1, modifiedAt: new Date(now).toISOString() },
        { path: path.join(root, 'missing.tmp'), kind: 'file', sizeBytes: 1, modifiedAt: new Date(now).toISOString() }]
    }, { approved: true, dryRun: false });
    expect(result.removed).toEqual(expect.arrayContaining([oldFile, oldDir]));
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: outside, reason: 'outside-approved-root' }),
      expect.objectContaining({ path: link, reason: 'symlink' }),
      expect.objectContaining({ path: path.join(root, 'missing.tmp') })
    ]));
    await expect(fs.access(outside)).resolves.toBeUndefined();
    await fs.rm(outside, { force: true });
  });

  test('covers missing roots, races, deep traversal limits, and invalid cleanup plans', async () => {
    const defaults = createCacheCleaner({ osImpl: { tmpdir: () => path.dirname(root) }, env: {} });
    expect(defaults.rootsFor('user-temp', 'linux')).toEqual([path.resolve(root)]);
    await expect(defaults.preview({ target: 'shader-cache', platform: 'linux' })).resolves.toEqual(expect.objectContaining({ items: [] }));
    const missingRootCleaner = createCacheCleaner({ osImpl: { tmpdir: () => path.dirname(root) }, env: { HOME: path.join(root, 'missing-home') }, now: () => now });
    await expect(missingRootCleaner.preview({ target: 'shader-cache', platform: 'linux' })).resolves.toEqual(expect.objectContaining({ items: [] }));
    await expect(defaults.clean(null)).rejects.toThrow('preview result');

    const raceFs = {
      readdir: jest.fn(async () => [{ name: 'gone' }]),
      lstat: jest.fn(async () => { throw new Error('vanished'); })
    };
    const raceCleaner = createCacheCleaner({ fsImpl: raceFs, osImpl: { tmpdir: () => path.dirname(root) }, env: {}, now: () => now });
    await expect(raceCleaner.preview({ maxAgeHours: 1 })).resolves.toEqual(expect.objectContaining({ items: [] }));

    let depth = 0;
    const deepFs = {
      readdir: jest.fn(async () => [{ name: `level-${depth++}` }]),
      lstat: jest.fn(async () => ({ mtimeMs: now + 1000, isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false }))
    };
    const deepCleaner = createCacheCleaner({ fsImpl: deepFs, osImpl: { tmpdir: () => path.dirname(root) }, env: {}, now: () => now });
    await expect(deepCleaner.preview({ maxAgeHours: 1 })).resolves.toEqual(expect.objectContaining({ items: [] }));
    expect(deepFs.readdir.mock.calls.length).toBe(3);

    const breakFs = {
      readdir: jest.fn(async () => [{ name: 'one' }, { name: 'two' }]),
      lstat: jest.fn(async () => ({ mtimeMs: now - 2 * 60 * 60 * 1000, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true, size: 1 }))
    };
    const breakCleaner = createCacheCleaner({ fsImpl: breakFs, osImpl: { tmpdir: () => path.dirname(root) }, env: {}, now: () => now });
    const breakPreview = await breakCleaner.preview({ maxAgeHours: 1, maxEntries: 1 });
    expect(breakPreview.items).toHaveLength(1);

    const recentFileFs = {
      readdir: jest.fn(async () => [{ name: 'fresh-file' }]),
      lstat: jest.fn(async () => ({ mtimeMs: now + 1000, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true, size: 1 }))
    };
    const recentFileCleaner = createCacheCleaner({ fsImpl: recentFileFs, osImpl: { tmpdir: () => path.dirname(root) }, env: {}, now: () => now });
    await expect(recentFileCleaner.preview({ maxAgeHours: 1 })).resolves.toEqual(expect.objectContaining({ items: [] }));

    const defaultArgCleaner = createCacheCleaner({ fsImpl: { readdir: async () => [] }, osImpl: { tmpdir: () => path.dirname(root) }, env: {}, now: () => now });
    await expect(defaultArgCleaner.preview()).resolves.toEqual(expect.objectContaining({ target: 'user-temp' }));

    const absolutePathImpl = { ...path, relative: () => '/absolute', isAbsolute: () => true };
    const guarded = createCacheCleaner({ pathImpl: absolutePathImpl, osImpl: { tmpdir: () => path.dirname(root) }, env: {}, now: () => now });
    const guardedResult = await guarded.clean({ roots: [root], items: [{ path: path.join(root, 'file'), kind: 'file' }] }, { approved: true, dryRun: false });
    expect(guardedResult.skipped[0].reason).toBe('outside-approved-root');

    const fallbackRoots = defaultCacheRoots({ platform: 'win32', env: {}, osImpl: {} });
    expect(fallbackRoots['user-temp']).toEqual([]);
    expect(defaultCacheRoots({ platform: 'linux', env: { USERPROFILE: '/profile' }, osImpl: { tmpdir: () => root } })['shader-cache'][0]).toContain('/profile');
    expect(defaultCacheRoots()['app-cache']).toEqual([]);
    const exactRoot = await guarded.clean({ roots: [root], items: [{ path: root, kind: 'directory' }] }, { approved: true, dryRun: false });
    expect(exactRoot.skipped[0].reason).toBe('outside-approved-root');
  });
});
