/**
 * Native media library tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  createMediaLibrary,
  MEDIA_LIBRARY_VERSION,
  scanMediaRoot
} from '../native/media-library.js';

const HASH_A = 'a'.repeat(64);

describe('media root catalogue', () => {
  let root;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-media-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  test('catalogues supported media, hashes duplicates, and leaves files untouched', async () => {
    await fs.mkdir(path.join(root, 'nested'));
    await fs.mkdir(path.join(root, 'nested', 'inner'));
    await fs.writeFile(path.join(root, 'morning.mp3'), 'same');
    await fs.writeFile(path.join(root, 'evening.flac'), 'same');
    await fs.writeFile(path.join(root, 'movie.mp4'), 'movie');
    await fs.writeFile(path.join(root, 'cover.jpg'), 'image');
    await fs.writeFile(path.join(root, 'notes.txt'), 'ignore');
    await fs.writeFile(path.join(root, 'nested', 'clip.webm'), 'clip');
    await fs.writeFile(path.join(root, 'nested', 'inner', 'deep.mp3'), 'deep');
    const result = await scanMediaRoot(root, { hashFiles: true });
    expect(result).toMatchObject({ version: MEDIA_LIBRARY_VERSION, itemCount: 6, mutation: 'none' });
    expect(result.items.map((item) => item.type)).toEqual(expect.arrayContaining(['audio', 'audio', 'video', 'video', 'video', 'image']));
    expect(result.items.find((item) => item.title === 'morning')).toMatchObject({ extension: '.mp3', sha256: expect.any(String) });
    expect(result.duplicates).toHaveLength(1);
    expect(await fs.readFile(path.join(root, 'morning.mp3'), 'utf8')).toBe('same');
  });

  test('bounds traversal and rejects unsafe scan settings', async () => {
    await fs.mkdir(path.join(root, 'nested'));
    await fs.writeFile(path.join(root, 'file.mp3'), 'x');
    await fs.writeFile(path.join(root, 'nested', 'deep.mp3'), 'y');
    const result = await scanMediaRoot(root, { maxEntries: 1, maxDepth: 0, hashFiles: true, maxHashBytes: 0 });
    expect(result).toMatchObject({ itemCount: 1, truncated: true });
    expect(result.items[0].sha256).toBeNull();
    await expect(scanMediaRoot(root, { maxDepth: 0 })).resolves.toMatchObject({ itemCount: 1 });
    await expect(scanMediaRoot('')).rejects.toThrow('explicit root');
    await expect(scanMediaRoot(root, { maxEntries: 0 })).rejects.toThrow('maxEntries');
    await expect(scanMediaRoot(root, { maxDepth: 9 })).rejects.toThrow('maxDepth');
    await expect(scanMediaRoot(root, { maxHashBytes: -1 })).rejects.toThrow('maxHashBytes');
  });

  test('fails closed on unreadable roots, symlinks, and hashing errors', async () => {
    const entries = [
      { name: 'link.mp3', isSymbolicLink: () => true },
      { name: 'folder', isDirectory: () => true, isSymbolicLink: () => false },
      { name: 'ignore.mp3', isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'race.mp3', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'song.mp3', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
      { name: '---.mp3', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'null.mp3', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false },
      { name: 'zero.mp3', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }
    ];
    const fsImpl = { readdir: jest.fn(async (rootPath) => { if (rootPath === '/bad') throw new Error('denied'); return rootPath === '/root' ? entries : []; }), stat: jest.fn(async (filePath) => { if (filePath.endsWith('race.mp3')) throw new Error('race'); return { size: filePath.endsWith('null.mp3') ? null : filePath.endsWith('zero.mp3') ? 0 : 4, mtimeMs: NaN }; }) };
    const result = await scanMediaRoot('/root', { fsImpl, hashFiles: true, hashFileImpl: async () => { throw new Error('hash'); } });
    expect(result).toMatchObject({ itemCount: 4, symlinkCount: 1, raceCount: 1, unreadableRoots: 0 });
    expect(result.items.find((item) => item.title === 'untitled')).toMatchObject({ sha256: null, modifiedAt: null, sizeBytes: 4 });
    await expect(scanMediaRoot('/bad', { fsImpl })).resolves.toMatchObject({ unreadableRoots: 1, itemCount: 0 });
  });
});

describe('media library state', () => {
  let root;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-media-state-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  test('persists favorites, recent history, playlists, and playback plans', async () => {
    const filePath = path.join(root, 'nested', 'library.json');
    const library = createMediaLibrary({ filePath, now: () => 123 });
    expect(await library.read()).toMatchObject({ version: MEDIA_LIBRARY_VERSION, favorites: [], recent: [], playlists: {} });
    await library.favorite('/music/a.mp3');
    await library.favorite('/music/a.mp3');
    await library.favorite('/music/a.mp3', false);
    await library.played('/music/b.mp3');
    await library.played('/music/a.mp3');
    await library.playlist('Morning', ['/music/a.mp3', '/music/b.mp3']);
    expect(await library.read()).toMatchObject({ favorites: [], recent: ['/music/a.mp3', '/music/b.mp3'], lastPlayedAt: 123, playlists: { Morning: ['/music/a.mp3', '/music/b.mp3'] } });
    expect(JSON.parse(await library.exportPlaylist('Morning'))).toMatchObject({ name: 'Morning', tracks: ['/music/a.mp3', '/music/b.mp3'] });
    await library.importPlaylist(JSON.stringify({ name: 'Imported', tracks: ['/music/c.mp3'] }));
    expect((await library.read()).playlists.Imported).toEqual(['/music/c.mp3']);
    expect(library.playbackPlan('/music/a.mp3')).toMatchObject({ state: 'review-ready', authority: 'player-host-required' });
    expect(library.playbackPlan('')).toMatchObject({ state: 'refused', path: null });
  });

  test('validates state and refuses malformed persistence inputs', async () => {
    const filePath = path.join(root, 'library.json');
    const library = createMediaLibrary({ filePath });
    await library.write({ favorites: ['a', 2], recent: null, playlists: [], lastPlayedAt: 'bad' });
    expect(await library.read()).toMatchObject({ favorites: ['a'], recent: [], playlists: {}, lastPlayedAt: null });
    await library.write(null);
    expect(await library.read()).toMatchObject({ favorites: [], recent: [], playlists: {} });
    await fs.writeFile(filePath, '{bad}');
    await expect(library.read()).rejects.toThrow();
    await library.write({});
    expect(JSON.parse(await library.exportPlaylist('missing')).tracks).toEqual([]);
    await expect(library.importPlaylist()).rejects.toThrow();
    await library.importPlaylist(JSON.stringify({ tracks: null }));
    expect((await library.read()).playlists['Imported playlist']).toEqual([]);
    await fs.writeFile(filePath, 'x'.repeat(1024 * 1024 + 1));
    await expect(library.read()).rejects.toThrow('too large');
    expect(() => createMediaLibrary()).toThrow('state file path');
    expect(() => createMediaLibrary({ filePath, now: 1 })).toThrow('clock');
    expect(() => library.playlist('', [])).toThrow('playlist requires');
  });
});

test('library exposes explicit scan and state operations without mutation authority', () => {
  const library = createMediaLibrary({ filePath: '/tmp/library.json' });
  expect(library.version).toBe(MEDIA_LIBRARY_VERSION);
  expect(typeof library.scan).toBe('function');
  expect(library.playbackPlan('/tmp/a.mp3')).toMatchObject({ mutation: 'none' });
});
