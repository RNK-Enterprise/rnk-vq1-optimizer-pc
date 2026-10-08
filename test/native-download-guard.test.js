/**
 * Native download guard tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  createDownloadGuard,
  DOWNLOAD_GUARD_VERSION,
  preflightDownload,
  scanDownloadRoot,
  verifyDownloadHash
} from '../native/download-guard.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('download preflight and verification', () => {
  test('chooses a safe destination without starting a download', () => {
    expect(preflightDownload()).toMatchObject({ state: 'observation-required', sizeBytes: null });
    expect(preflightDownload({ sizeBytes: 100, destinationMount: 'C:', volumes: [{ mount: 'C:', freeBytes: 100 }] })).toMatchObject({ state: 'allow', targetMount: 'C:' });
    expect(preflightDownload({ sizeBytes: '100', destinationMount: 'C:', volumes: [{ mount: 'C:', freeBytes: 50 }, { mount: 'E:', freeBytes: 200 }] })).toMatchObject({ state: 'redirect', targetMount: 'E:' });
    expect(preflightDownload({ sizeBytes: 300, destinationMount: 'C:', volumes: [{ mount: 'C:', freeBytes: 50, writable: false }, { mount: 'E:', freeBytes: 200 }] })).toMatchObject({ state: 'insufficient-space', targetMount: 'C:' });
    expect(preflightDownload({ sizeBytes: 300, volumes: [{ mount: 'E:', freeBytes: 200 }] })).toMatchObject({ state: 'insufficient-space', targetMount: null });
    expect(preflightDownload({ sizeBytes: 100, destinationMount: 'X:', volumes: [{ mount: 'E:', freeBytes: 100 }, { mount: 'F:', freeBytes: 200 }, { mount: 'G:', freeBytes: 150 }] })).toMatchObject({ state: 'redirect', targetMount: 'F:' });
    expect(preflightDownload({ sizeBytes: 1, volumes: null })).toMatchObject({ state: 'insufficient-space' });
  });

  test('verifies matching, mismatching, unavailable, and invalid hashes', async () => {
    await expect(verifyDownloadHash('/tmp/file', HASH_A, { hashFileImpl: async () => HASH_A })).resolves.toMatchObject({ state: 'verified', actualHash: HASH_A });
    await expect(verifyDownloadHash('/tmp/file', HASH_A, { hashFileImpl: async () => HASH_B })).resolves.toMatchObject({ state: 'mismatch', reason: 'sha256-does-not-match' });
    await expect(verifyDownloadHash('/tmp/file', HASH_A, { hashFileImpl: async () => { throw new Error('locked'); } })).resolves.toMatchObject({ state: 'unavailable', reason: 'locked' });
    await expect(verifyDownloadHash('', HASH_A)).rejects.toThrow('explicit root');
    await expect(verifyDownloadHash('/tmp/file', 'bad')).rejects.toThrow('SHA-256');
    await expect(verifyDownloadHash('/tmp/file', '')).rejects.toThrow('SHA-256');
  });
});

describe('download root scanning', () => {
  let root;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-download-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  test('finds incomplete files and hash duplicates with no mutation', async () => {
    await fs.mkdir(path.join(root, 'nested'));
    await fs.writeFile(path.join(root, 'one.bin'), 'same');
    await fs.writeFile(path.join(root, 'two.bin'), 'same');
    await fs.writeFile(path.join(root, 'partial.crdownload'), 'partial');
    await fs.writeFile(path.join(root, 'nested', 'three.bin'), 'other');
    const result = await scanDownloadRoot(root, { hashFiles: true });
    expect(result).toMatchObject({ version: DOWNLOAD_GUARD_VERSION, entryCount: 4, mutation: 'none', symlinkCount: 0 });
    expect(result.incomplete.map((item) => item.name)).toEqual(['partial.crdownload']);
    expect(result.duplicates).toHaveLength(1);
    expect(await fs.readFile(path.join(root, 'one.bin'), 'utf8')).toBe('same');
    await expect(verifyDownloadHash(path.join(root, 'one.bin'), result.duplicates[0].sha256)).resolves.toMatchObject({ state: 'verified' });
  });

  test('bounds depth and entries and reports hash limits', async () => {
    await fs.mkdir(path.join(root, 'deep'));
    await fs.writeFile(path.join(root, 'large.bin'), '123456');
    await fs.writeFile(path.join(root, 'deep', 'nested.bin'), 'nested');
    const result = await scanDownloadRoot(root, { maxEntries: 1, maxDepth: 0, hashFiles: true, maxHashBytes: 1 });
    expect(result).toMatchObject({ entryCount: 1, truncated: true });
    expect(result.entries[0].hashState).toBe('too-large-to-hash');
    await expect(scanDownloadRoot(root, { maxEntries: 0 })).rejects.toThrow('maxEntries');
    await expect(scanDownloadRoot(root, { maxDepth: 9 })).rejects.toThrow('maxDepth');
    await expect(scanDownloadRoot(root, { maxHashBytes: -1 })).rejects.toThrow('maxHashBytes');
    await expect(scanDownloadRoot('')).rejects.toThrow('explicit root');
    const invalidHash = await scanDownloadRoot(root, { hashFiles: true, hashFileImpl: async () => 'bad' });
    expect(invalidHash.entries.some((entry) => entry.hashState === 'invalid-hash')).toBe(true);
  });

  test('fails closed on unreadable entries, symlinks, and hash errors', async () => {
    const entries = [
      { name: 'link', isSymbolicLink: () => true },
      { name: 'directory', isDirectory: () => true, isSymbolicLink: () => false },
      { name: 'ignored', isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'race.bin', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'bad.bin', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'zero.bin', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }
    ];
    const fsImpl = {
      readdir: jest.fn(async (rootPath) => { if (rootPath === '/bad') throw new Error('denied'); return rootPath === '/root' ? entries : []; }),
      stat: jest.fn(async (filePath) => { if (filePath.endsWith('race.bin')) throw new Error('race'); return { size: filePath.endsWith('zero.bin') ? 0 : 10, mtimeMs: NaN }; })
    };
    const result = await scanDownloadRoot('/root', { fsImpl, pathImpl: path, hashFiles: true, hashFileImpl: async () => { throw new Error('hash'); } });
    expect(result).toMatchObject({ entryCount: 2, symlinkCount: 1, raceCount: 1, unreadableRoots: 0 });
    expect(result.entries[0]).toMatchObject({ hashState: 'unavailable', modifiedAt: null });
    await expect(scanDownloadRoot('/bad', { fsImpl })).resolves.toMatchObject({ unreadableRoots: 1, entryCount: 0 });
    await expect(scanDownloadRoot('/root', { fsImpl, hashFiles: false })).resolves.toMatchObject({ entryCount: 2 });
    const limitedFs = { readdir: async () => [
      { name: 'one', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'two', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }
    ], stat: async () => ({ size: 1, mtimeMs: 0 }) };
    await expect(scanDownloadRoot('/limited', { fsImpl: limitedFs, maxEntries: 1 })).resolves.toMatchObject({ entryCount: 1, truncated: true });
  });
});

test('creates a reusable guard with bounded option merging', async () => {
  const emptyGuard = createDownloadGuard();
  await expect(emptyGuard.scan('/missing')).resolves.toMatchObject({ unreadableRoots: 1 });
  const guard = createDownloadGuard({ hashFiles: true, hashFileImpl: async () => HASH_A });
  expect(guard.version).toBe(DOWNLOAD_GUARD_VERSION);
  expect(guard.preflight({ sizeBytes: 1, volumes: [{ mount: 'E:', freeBytes: 2 }] })).toMatchObject({ state: 'redirect', targetMount: 'E:' });
  const fsImpl = { readdir: async () => [{ name: 'file', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }], stat: async () => ({ size: 1, mtimeMs: 0 }) };
  await expect(guard.scan('/root', { fsImpl })).resolves.toMatchObject({ entryCount: 1, duplicates: [] });
  await expect(guard.verify('/file', HASH_A)).resolves.toMatchObject({ state: 'verified' });
});
