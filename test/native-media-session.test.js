import { createMediaSession, MEDIA_SESSION_VERSION, mediaSessionTrack } from '../native/media-session.js';
import path from 'path';

const fileFs = { lstat: async () => ({ isSymbolicLink: () => false, isFile: () => true }) };

function runner(result = { code: 0 }) { return { run: jest.fn().mockResolvedValue(result) }; }

describe('native local media session', () => {
  test('keeps queue state separate from playback authority', async () => {
    const session = createMediaSession({ queue: ['/music/a.mp3'], now: () => 1, commandRunner: runner() });
    expect(mediaSessionTrack(' /music/a.mp3 ')).toBe('/music/a.mp3');
    expect(mediaSessionTrack('')).toBeNull();
    expect(session.read()).toMatchObject({ version: MEDIA_SESSION_VERSION, authority: 'local-default-player', player: { track: '/music/a.mp3', playing: false } });
    expect(await session.command('shuffle', true)).toMatchObject({ state: 'state-updated', player: { shuffle: true } });
    expect(await session.command('pause')).toMatchObject({ state: 'state-updated', player: { playing: false } });
    expect((await session.command('next')).player.track).toBe('/music/a.mp3');
  });

  test('requires approval and does not mark a track playing during preview', async () => {
    const commandRunner = runner();
    const session = createMediaSession({ queue: ['/music/a.mp3'], platform: 'linux', pathImpl: path.posix, commandRunner, fsImpl: fileFs });
    expect(await session.play()).toMatchObject({ state: 'approval-required', player: { playing: false }, plan: { state: 'plan-ready' } });
    const preview = createMediaSession({ queue: ['/music/a.mp3'], platform: 'linux', pathImpl: path.posix, commandRunner, fsImpl: fileFs, approved: true });
    expect(await preview.play()).toMatchObject({ state: 'preview', player: { playing: false } });
    expect(commandRunner.run).not.toHaveBeenCalled();
  });

  test('opens the selected local file only after approved apply and records failure', async () => {
    const commandRunner = runner();
    const session = createMediaSession({ queue: ['/music/a.mp3'], platform: 'linux', pathImpl: path.posix, commandRunner, fsImpl: fileFs, approved: true, dryRun: false });
    const applied = await session.play();
    expect(applied).toMatchObject({ state: 'applied', player: { playing: true }, result: { applied: true } });
    expect(commandRunner.run).toHaveBeenCalledWith('xdg-open', ['/music/a.mp3'], expect.any(Object));
    const failed = createMediaSession({ queue: ['/music/b.mp3'], platform: 'linux', pathImpl: path.posix, commandRunner: runner({ code: 1, stderr: 'denied' }), fsImpl: fileFs, approved: true, dryRun: false });
    expect(await failed.play()).toMatchObject({ state: 'rejected', player: { playing: false }, result: { reason: 'denied' } });
  });

  test('refuses empty and unsupported sessions without claiming playback', async () => {
    const defaults = createMediaSession();
    expect(defaults.read()).toMatchObject({ player: { queue: [], track: null } });
    expect(await defaults.command('play')).toMatchObject({ state: 'refused', reason: 'media queue has no selected track' });
    const empty = createMediaSession({ commandRunner: runner() });
    expect(await empty.play()).toMatchObject({ state: 'refused', reason: 'media queue has no selected track' });
    const unsupported = createMediaSession({ queue: ['/music/a.mp3'], platform: 'plan9', pathImpl: path.posix, commandRunner: runner() });
    expect(await unsupported.play()).toMatchObject({ state: 'refused', player: { playing: false }, plan: { state: 'unsupported-platform' } });
  });
});
