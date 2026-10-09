/**
 * Native CLI media adapter tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildMediaPanelPlan, runMediaCommand, runMediaPlayerCommand } from '../native/cli-media.mjs';

let root;
let statePath;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-cli-media-'));
  statePath = path.join(root, 'media.json');
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('native CLI media adapter', () => {
  test('dispatches scan, metadata, playback, and panel plans with approval boundaries', async () => {
    await expect(runMediaCommand('media-scan', { root, 'max-entries': '4', 'max-depth': '1', 'max-hash-bytes': '1024', 'hash-files': true })).resolves.toMatchObject({ root, itemCount: 0, mutation: 'none' });
    await expect(runMediaCommand('media-metadata', { file: path.join(root, 'notes.txt') })).resolves.toMatchObject({ state: 'refused' });
    await expect(runMediaCommand('media-play', { file: path.join(root, 'notes.txt') })).rejects.toThrow('requires --confirm');
    await expect(runMediaCommand('media-play', { file: path.join(root, 'track.mp3'), confirm: true })).resolves.toMatchObject({ result: { state: 'rejected' } });
    await expect(runMediaCommand('media-panel-open', { url: 'https://not-allow-listed.example.invalid/watch', confirm: true })).rejects.toThrow('invalid');
    await expect(runMediaCommand('media-panel-open', { url: 'https://www.youtube.com/watch?v=abc' })).rejects.toThrow('requires --confirm');
    expect(buildMediaPanelPlan('https://www.youtube.com/watch?v=abc')).toMatchObject({ state: 'review-ready', requiresApproval: true });
  });

  test('dispatches all local library state operations', async () => {
    const args = { 'state-path': statePath };
    await expect(runMediaCommand('media-read', args)).resolves.toMatchObject({ version: 1, favorites: [], recent: [] });
    await expect(runMediaCommand('media-favorite', { ...args, file: '/music/a.mp3' })).resolves.toMatchObject({ favorites: ['/music/a.mp3'] });
    await expect(runMediaCommand('media-favorite', { ...args, file: '/music/a.mp3', disable: true })).resolves.toMatchObject({ favorites: [] });
    await expect(runMediaCommand('media-played', { ...args, file: '/music/b.mp3' })).resolves.toMatchObject({ recent: ['/music/b.mp3'] });
    await expect(runMediaCommand('media-playlist', { ...args, name: 'work', tracks: '["/music/b.mp3"]' })).resolves.toMatchObject({ playlists: { work: ['/music/b.mp3'] } });
    await expect(runMediaCommand('media-export', { ...args, name: 'work' })).resolves.toMatchObject({ version: 1, name: 'work', tracks: ['/music/b.mp3'] });
    await expect(runMediaCommand('media-import', { ...args, playlist: '{"name":"rest","tracks":["/music/c.mp3"]}' })).resolves.toMatchObject({ playlists: { rest: ['/music/c.mp3'] } });
    await expect(runMediaCommand('media-playback-plan', { ...args, file: '/music/c.mp3' })).resolves.toMatchObject({ state: 'review-ready', path: '/music/c.mp3' });
    await expect(runMediaCommand('unknown', args)).rejects.toThrow('Unknown media command');
  });

  test('dispatches local player state and approved-play preview paths', async () => {
    await expect(runMediaPlayerCommand({ tracks: '["/music/a.mp3","/music/b.mp3"]' })).resolves.toMatchObject({ track: '/music/a.mp3' });
    await expect(runMediaPlayerCommand({ tracks: '["/music/a.mp3","/music/b.mp3"]', action: 'select', index: '1', initial: '{"repeat":"all"}' })).resolves.toMatchObject({ track: '/music/b.mp3' });
    await expect(runMediaPlayerCommand({ tracks: '["/music/a.mp3","/music/b.mp3"]', action: 'shuffle', enabled: true })).resolves.toMatchObject({ shuffle: true });
    await expect(runMediaPlayerCommand({ tracks: '["/music/a.mp3"]', action: 'repeat', mode: 'one' })).resolves.toMatchObject({ repeat: 'one' });
    await expect(runMediaPlayerCommand({ tracks: '["/music/a.mp3"]', action: 'play' })).resolves.toMatchObject({ state: 'approval-required' });
    await expect(runMediaPlayerCommand({ tracks: '["/music/a.txt"]', action: 'play', initial: '{}', confirm: true })).resolves.toMatchObject({ state: 'refused' });
    await expect(runMediaPlayerCommand({ tracks: '["/music/a.mp3"]', action: 'bad' })).rejects.toThrow('Unsupported media player action');
  });
});
