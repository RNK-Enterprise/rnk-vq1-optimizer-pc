/**
 * Native file-insights tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { FILE_INSIGHTS_VERSION, buildFileInsightPlan, scanFileInsights } from '../native/file-insights.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const hash = 'a'.repeat(64);

function fsFixture(entries, stats = {}) {
  return {
    readdir: jest.fn(async (root) => root === '/bad' ? (() => { throw new Error('denied'); })() : entries[root] || []),
    stat: jest.fn(async (file) => stats[file] || { size: 10, mtimeMs: 0 })
  };
}

describe('native file insights', () => {
  test('scans bounded categories, protection, hashes, and evidence groups', async () => {
    const entries = {
      '/root': [
        { name: 'old.exe', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'partial.crdownload', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'model.gguf', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'one.zip', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'two.zip', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'disk.iso', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'repo', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'link', isSymbolicLink: () => true },
        { name: 'ignored', isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false }
      ],
      '/root/repo': [{ name: 'source.js', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }]
    };
    const stats = {
      '/root/old.exe': { size: 200, mtimeMs: 0 },
      '/root/partial.crdownload': { size: 10, mtimeMs: 1000 },
      '/root/model.gguf': { size: 2048, mtimeMs: 1000 },
      '/root/one.zip': { size: 20, mtimeMs: 1000 },
      '/root/two.zip': { size: 20, mtimeMs: 1000 },
      '/root/disk.iso': { size: 20, mtimeMs: 1000 },
      '/root/repo/source.js': { size: 10, mtimeMs: 1000 }
    };
    const result = await scanFileInsights('/root', { fsImpl: fsFixture(entries, stats), protectedRoots: [{ ignored: true }, '/root/repo'], hashFiles: true, largeFileBytes: 100, minAgeHours: 1, now: () => 3600000, hashFileImpl: async (file) => file.endsWith('zip') ? hash : 'bad' });
    expect(result).toMatchObject({ version: FILE_INSIGHTS_VERSION, entryCount: 7, mutation: 'none', protectedCount: 1, symlinkCount: 1 });
    expect(result.incomplete[0].category).toBe('incomplete-download');
    expect(result.staleInstallers[0].name).toBe('old.exe');
    expect(result.largeFiles.map((item) => item.name)).toEqual(expect.arrayContaining(['old.exe', 'model.gguf']));
    expect(result.duplicates).toHaveLength(1);
    expect(result.entries.find((item) => item.name === 'disk.iso').category).toBe('iso');
    expect(result.entries.find((item) => item.name === 'source.js')).toMatchObject({ protected: true, category: 'other' });
  });

  test('builds review-only move suggestions and reports bounded failures', async () => {
    const scan = { root: '/root', policy: { minAgeHours: 10, largeFileBytes: 100 }, entries: [{ path: '/root/setup.exe', category: 'installer', ageHours: 20, sizeBytes: 10, protected: false }, { path: '/root/model.gguf', category: 'model', ageHours: 1, sizeBytes: 200, protected: false }, { path: '/root/readme', category: 'other', ageHours: 1, sizeBytes: 1, protected: false }, { path: '/root/partial.part', category: 'incomplete-download', ageHours: 1, sizeBytes: 1, protected: false }, { path: '/root/secret.zip', category: 'archive', ageHours: 20, sizeBytes: 20, protected: true }], duplicates: [{ sha256: hash, paths: ['/root/a', '/root/b'] }] };
    const plan = buildFileInsightPlan(scan, { targetRoot: '/archive' });
    expect(plan).toMatchObject({ version: FILE_INSIGHTS_VERSION, targetRoot: '/archive', requiresApproval: true, mutation: 'none' });
    expect(plan.review).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'stale-installer', destination: '/archive/installer/setup.exe' }), expect.objectContaining({ reason: 'large-file', destination: '/archive/model/model.gguf' })]));
    expect(plan.review).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: '/root/secret.zip' })]));
    expect(plan.duplicates[0]).toMatchObject({ operation: 'review-duplicate-group', mutation: 'none' });
    expect(buildFileInsightPlan({ root: '/root', entries: [], policy: { minAgeHours: 1, largeFileBytes: 1 } })).toMatchObject({ targetRoot: null, review: [] });
    await expect(scanFileInsights('')).rejects.toThrow('explicit root');
    await expect(scanFileInsights('/root', { maxEntries: 0 })).rejects.toThrow('maxEntries');
    await expect(scanFileInsights('/root', { maxDepth: 13 })).rejects.toThrow('maxDepth');
    await expect(scanFileInsights('/root', { minAgeHours: -1 })).rejects.toThrow('policy');
    await expect(scanFileInsights('/root', { now: 1 })).rejects.toThrow('clock');
    await expect(scanFileInsights('/root', { now: () => NaN })).rejects.toThrow('clock');
    await expect(scanFileInsights('/bad', { fsImpl: fsFixture({}), now: () => 0 })).resolves.toMatchObject({ entryCount: 0, unreadableRoots: 1 });
    await expect(scanFileInsights('/root', { fsImpl: fsFixture({}), protectedRoots: {}, now: () => 0 })).resolves.toMatchObject({ entryCount: 0 });
    const edgeEntries = {
      '/edge': [
        { name: 'nested', isDirectory: () => true, isSymbolicLink: () => false },
        { name: '.git', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'bad-size.bin', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }
      ],
      '/limit': [
        { name: 'one.bin', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'two.bin', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }
      ]
    };
    const edgeFs = fsFixture(edgeEntries, { '/edge/bad-size.bin': { size: 'bad', mtimeMs: NaN }, '/limit/one.bin': { size: 1, mtimeMs: 0 } });
    await expect(scanFileInsights('/edge', { fsImpl: edgeFs, maxDepth: 0, now: () => 0 })).resolves.toMatchObject({ entryCount: 1, entries: [{ sizeBytes: 0, ageHours: null, modifiedAt: null, hashState: 'not-requested' }] });
    await expect(scanFileInsights('/limit', { fsImpl: edgeFs, maxEntries: 1, now: () => 0 })).resolves.toMatchObject({ entryCount: 1, truncated: true });
    expect(() => buildFileInsightPlan(null)).toThrow('scan is required');
  });

  test('uses the bounded default hash path and reports hash-size limits', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-file-insights-'));
    try {
      await fs.writeFile(path.join(root, 'one.zip'), 'same');
      await fs.writeFile(path.join(root, 'two.zip'), 'same');
      const hashed = await scanFileInsights(root, { hashFiles: true, now: () => Date.now() });
      expect(hashed.duplicates).toHaveLength(1);
      const entries = [{ name: 'large.zip', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }];
      const limited = await scanFileInsights('/root', { fsImpl: fsFixture({ '/root': entries }, { '/root/large.zip': { size: 10, mtimeMs: 0 } }), hashFiles: true, maxHashBytes: 1, now: () => 0 });
      expect(limited.entries[0].hashState).toBe('too-large-to-hash');
      await expect(scanFileInsights('/race', { fsImpl: { readdir: async () => entries, stat: async () => { throw new Error('race'); } }, now: () => 0 })).resolves.toMatchObject({ entryCount: 0, raceCount: 1 });
      const badHash = await scanFileInsights('/hash', { fsImpl: fsFixture({ '/hash': entries }, { '/hash/large.zip': { size: 1, mtimeMs: 0 } }), hashFiles: true, hashFileImpl: async () => { throw new Error('locked'); }, now: () => 0 });
      expect(badHash.entries[0].hashState).toBe('unavailable');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
