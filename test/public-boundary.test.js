/**
 * Public-checkout boundary tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { scanPublicBoundary, PUBLIC_BOUNDARY_VERSION } from '../native/public-boundary.js';
import path from 'path';

function fakeFs(files, directories = {}) {
  return {
    readdir: jest.fn(async (directory) => directories[directory] || files[directory] || []),
    stat: jest.fn(async (file) => ({ size: Buffer.byteLength(files[file] || '') })),
    readFile: jest.fn(async (file) => files[file] || '')
  };
}

describe('public checkout boundary', () => {
  test('scans bounded text files, nested directories, and skipped generated paths', async () => {
    const fsImpl = fakeFs({
      '/repo/clean.js': 'const value = 1;',
      '/repo/nested/readme.md': 'safe',
      '/repo/package-lock.json': 'ignored',
      '/repo/.github/workflow.yml': 'ignored'
    }, {
      '/repo': [
        { name: 'clean.js', isFile: () => true },
        { name: 'nested', isDirectory: () => true },
        { name: 'link', isFile: () => false },
        { name: 'package-lock.json', isFile: () => true },
        { name: '.github', isDirectory: () => true }
      ],
      '/repo/nested': [{ name: 'readme.md', isFile: () => true }]
    });
    await expect(scanPublicBoundary({ root: '/repo', fsImpl, pathImpl: path.posix })).resolves.toMatchObject({ version: PUBLIC_BOUNDARY_VERSION, state: 'clean', scannedFiles: 2, skippedFiles: 0, matches: [] });
    expect(fsImpl.readFile).toHaveBeenCalledTimes(2);
    await expect(scanPublicBoundary()).resolves.toMatchObject({ state: 'clean' });
  });

  test('reports forbidden matches, incomplete bounds, and malformed options', async () => {
    const fsImpl = fakeFs({ '/repo/bad.txt': `safe\n${['fo', 'undry'].join('')}` }, { '/repo': [{ name: 'bad.txt', isFile: () => true }] });
    await expect(scanPublicBoundary({ root: '/repo', fsImpl, pathImpl: path.posix })).resolves.toMatchObject({ state: 'forbidden-reference', matches: [{ path: 'bad.txt', line: 2 }] });
    const oversized = fakeFs({ '/repo/large.txt': 'large' }, { '/repo': [{ name: 'large.txt', isFile: () => true }] });
    await expect(scanPublicBoundary({ root: '/repo', fsImpl: oversized, pathImpl: path.posix, maxBytes: 1 })).resolves.toMatchObject({ state: 'incomplete', scannedFiles: 0, skippedFiles: 1 });
    const bounded = fakeFs({ '/repo/one.txt': 'one', '/repo/two.txt': 'two' }, { '/repo': [{ name: 'one.txt', isFile: () => true }, { name: 'two.txt', isFile: () => true }] });
    await expect(scanPublicBoundary({ root: '/repo', fsImpl: bounded, pathImpl: path.posix, maxFiles: 1 })).resolves.toMatchObject({ state: 'clean', scannedFiles: 1 });
    await expect(scanPublicBoundary({ root: '', fsImpl })).rejects.toThrow('Public boundary root is required');
    await expect(scanPublicBoundary({ root: '/repo', fsImpl, maxFiles: 0 })).rejects.toThrow('Public boundary file limit is out of range');
    await expect(scanPublicBoundary({ root: '/repo', fsImpl, maxBytes: 0 })).rejects.toThrow('Public boundary byte limit is out of range');
  });

  test('returns unavailable instead of clean when traversal fails', async () => {
    const fsImpl = { readdir: jest.fn(async () => { throw new Error('permission denied'); }) };
    await expect(scanPublicBoundary({ root: '/repo', fsImpl })).resolves.toMatchObject({ state: 'unavailable', reason: 'permission denied' });
    const statFailure = fakeFs({}, { '/repo': [{ name: 'broken.txt', isFile: () => true }] });
    statFailure.stat = jest.fn(async () => { throw new Error('stat failed'); });
    await expect(scanPublicBoundary({ root: '/repo', fsImpl: statFailure, pathImpl: path.posix })).resolves.toMatchObject({ state: 'unavailable', reason: 'stat failed' });
    const readFailure = fakeFs({}, { '/repo': [{ name: 'broken.txt', isFile: () => true }] });
    readFailure.readFile = jest.fn(async () => { throw new Error('read failed'); });
    await expect(scanPublicBoundary({ root: '/repo', fsImpl: readFailure, pathImpl: path.posix })).resolves.toMatchObject({ state: 'unavailable', reason: 'read failed' });
  });
});
