/**
 * Native persistent protected-root tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  createProtectedRootsStore,
  normalizeProtectedRoots,
  parseProtectedRootsRecord,
  PROTECTED_ROOTS_VERSION
} from '../native/protected-roots.js';

describe('native protected roots registry', () => {
  let root;

  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-protected-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  test('normalizes bounded paths and rejects invalid bounds', () => {
    expect(normalizeProtectedRoots(['/work', '/work', '', null, '/models'], { maxEntries: 1 })).toEqual([path.resolve('/work')]);
    expect(normalizeProtectedRoots('not-an-array')).toEqual([]);
    expect(normalizeProtectedRoots([0, false, {}])).toEqual([]);
    expect(() => normalizeProtectedRoots([], { maxEntries: 0 })).toThrow('maxEntries');
    expect(() => normalizeProtectedRoots([], { maxEntries: 513 })).toThrow('maxEntries');
    expect(() => normalizeProtectedRoots([], { maxEntries: 1.5 })).toThrow('maxEntries');
  });

  test('parses valid records and fails closed for malformed records', () => {
    expect(parseProtectedRootsRecord({ version: PROTECTED_ROOTS_VERSION, roots: ['/work', '/work'] })).toMatchObject({ state: 'ready', roots: [path.resolve('/work')] });
    for (const value of [null, {}, { version: 2, roots: [] }, { version: 1, roots: 'bad' }]) {
      expect(parseProtectedRootsRecord(value)).toMatchObject({ state: 'unavailable', roots: [] });
    }
  });

  test('reads missing state, adds/removes roots, and persists only paths', async () => {
    const filePath = path.join(root, 'nested', 'protected-roots.json');
    const store = createProtectedRootsStore({ filePath });
    expect(store.version).toBe(PROTECTED_ROOTS_VERSION);
    await expect(store.read()).resolves.toMatchObject({ state: 'ready', roots: [] });
    await expect(store.add([path.join(root, 'projects'), path.join(root, 'models')])).resolves.toMatchObject({ state: 'ready', roots: expect.any(Array) });
    const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(saved).toEqual({ version: PROTECTED_ROOTS_VERSION, roots: [path.join(root, 'projects'), path.join(root, 'models')] });
    await expect(store.add([path.join(root, 'projects')])).resolves.toMatchObject({ roots: saved.roots });
    await expect(store.remove([path.join(root, 'projects')])).resolves.toMatchObject({ roots: [path.join(root, 'models')] });
    await expect(store.remove(['/not-configured'])).resolves.toMatchObject({ roots: [path.join(root, 'models')] });
    await expect(store.add([])).rejects.toThrow('at least one path');
  });

  test('fails closed on malformed or unavailable state and write failures', async () => {
    const filePath = path.join(root, 'roots.json');
    await fs.writeFile(filePath, '{bad');
    await expect(createProtectedRootsStore({ filePath }).read()).resolves.toMatchObject({ state: 'unavailable' });
    await fs.writeFile(filePath, JSON.stringify({ version: 2, roots: [] }));
    await expect(createProtectedRootsStore({ filePath }).read()).resolves.toMatchObject({ state: 'unavailable' });
    const denied = createProtectedRootsStore({ filePath, fsImpl: { readFile: jest.fn().mockRejectedValue(new Error('denied')) } });
    await expect(denied.read()).resolves.toMatchObject({ state: 'unavailable', reason: 'denied' });
    await expect(denied.add(['/work'])).rejects.toThrow('denied');
    const silent = createProtectedRootsStore({ filePath, fsImpl: { readFile: jest.fn().mockRejectedValue(new Error()) } });
    await expect(silent.read()).resolves.toMatchObject({ state: 'unavailable', reason: 'protected roots read failed' });
    await expect(silent.add(['/work'])).rejects.toThrow('protected roots read failed');
    const writeFailure = createProtectedRootsStore({
      filePath,
      fsImpl: {
        readFile: jest.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
        mkdir: jest.fn().mockResolvedValue(undefined),
        writeFile: jest.fn().mockRejectedValue(new Error('read-only'))
      }
    });
    await expect(writeFailure.add(['/work'])).rejects.toThrow('read-only');
  });

  test('validates store construction and max-entry limits', () => {
    expect(() => createProtectedRootsStore()).toThrow('file path');
    expect(() => createProtectedRootsStore({ filePath: path.join(root, 'roots.json'), maxEntries: 0 })).toThrow('maxEntries');
  });
});
