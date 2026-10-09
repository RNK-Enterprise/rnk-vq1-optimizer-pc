/**
 * Native local-media playback tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { applyMediaPlayback, buildMediaPlaybackPlan, MEDIA_PLAYBACK_VERSION } from '../native/media-playback.js';
import path from 'path';

const fileFs = { lstat: async () => ({ isSymbolicLink: () => false, isFile: () => true }) };

describe('native local-media playback authority', () => {
  test('builds fixed opener plans for supported platforms and refuses unsafe targets', () => {
    expect(buildMediaPlaybackPlan()).toMatchObject({ version: MEDIA_PLAYBACK_VERSION, state: 'refused' });
    expect(buildMediaPlaybackPlan('https://example.com/a.mp3')).toMatchObject({ state: 'refused' });
    expect(buildMediaPlaybackPlan('/music/a.txt')).toMatchObject({ state: 'refused', reason: 'media file extension is not supported' });
    expect(buildMediaPlaybackPlan('/music/a.mp3', { platform: 'linux', pathImpl: path.posix })).toMatchObject({ state: 'plan-ready', command: { file: 'xdg-open', args: ['/music/a.mp3'] }, requiresApproval: true });
    expect(buildMediaPlaybackPlan('/music/a.mp4', { platform: 'darwin', pathImpl: path.posix })).toMatchObject({ state: 'plan-ready', command: { file: 'open' } });
    expect(buildMediaPlaybackPlan('C:\\Music\\a.mp3', { platform: 'win32' })).toMatchObject({ state: 'plan-ready', command: { file: 'explorer.exe' } });
    expect(buildMediaPlaybackPlan('/music/a.mp3', { platform: 'plan9', pathImpl: path.posix })).toMatchObject({ state: 'unsupported-platform' });
  });

  test('requires approval, validates the exact file, and reports opener outcomes', async () => {
    const plan = buildMediaPlaybackPlan('/music/a.mp3', { platform: 'linux', pathImpl: path.posix });
    await expect(applyMediaPlayback(plan)).rejects.toThrow('command runner');
    expect(await applyMediaPlayback({ version: MEDIA_PLAYBACK_VERSION, state: 'refused', operation: 'play-local-media', reason: 'blocked' }, { commandRunner: { run: jest.fn() } })).toMatchObject({ state: 'refused' });
    expect(await applyMediaPlayback({ version: MEDIA_PLAYBACK_VERSION, state: 'refused', operation: 'play-local-media' }, { commandRunner: { run: jest.fn() } })).toMatchObject({ state: 'refused', reason: 'media playback plan is not ready' });
    expect(await applyMediaPlayback(plan, { commandRunner: { run: jest.fn() } })).toMatchObject({ state: 'approval-required' });
    expect(await applyMediaPlayback(plan, { commandRunner: { run: jest.fn() }, approved: true })).toMatchObject({ state: 'preview' });
    const run = jest.fn().mockResolvedValue({ code: 0 });
    expect(await applyMediaPlayback(plan, { fsImpl: fileFs, commandRunner: { run } , approved: true, dryRun: false })).toMatchObject({ state: 'applied', applied: true });
    expect(run).toHaveBeenCalledWith('xdg-open', ['/music/a.mp3'], { timeoutMs: 5000, maxOutputBytes: 1024 });
    expect(await applyMediaPlayback(plan, { fsImpl: fileFs, commandRunner: { run: jest.fn().mockResolvedValue({ code: 1, stderr: 'denied' }) }, approved: true, dryRun: false })).toMatchObject({ state: 'rejected', reason: 'denied' });
    expect(await applyMediaPlayback(plan, { fsImpl: fileFs, commandRunner: { run: jest.fn().mockResolvedValue({ code: 1 }) }, approved: true, dryRun: false })).toMatchObject({ state: 'rejected', reason: 'default-player opener failed' });
    expect(await applyMediaPlayback(plan, { fsImpl: fileFs, commandRunner: { run: jest.fn().mockRejectedValue(new Error('failed')) }, approved: true, dryRun: false })).toMatchObject({ state: 'rejected', reason: 'failed' });
  });

  test('refuses missing, symbolic-link, and non-file targets and malformed plans', async () => {
    const plan = buildMediaPlaybackPlan('/music/a.mp3', { platform: 'linux', pathImpl: path.posix });
    await expect(applyMediaPlayback(null, { commandRunner: { run: jest.fn() } })).rejects.toThrow('invalid');
    await expect(applyMediaPlayback(plan, { fsImpl: { lstat: async () => { throw new Error('missing'); } }, commandRunner: { run: jest.fn() }, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'missing' });
    await expect(applyMediaPlayback(plan, { fsImpl: { lstat: async () => ({ isSymbolicLink: () => true, isFile: () => false }) }, commandRunner: { run: jest.fn() }, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'symbolic links are not playable targets' });
    await expect(applyMediaPlayback(plan, { fsImpl: { lstat: async () => ({ isSymbolicLink: () => false, isFile: () => false }) }, commandRunner: { run: jest.fn() }, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'media target is not a regular file' });
    await expect(applyMediaPlayback(plan, { fsImpl: { lstat: async () => ({}) }, commandRunner: { run: jest.fn() }, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'media target is not a regular file' });
  });
});
