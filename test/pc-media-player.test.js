/**
 * PC browser media host tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { createPcMediaPlayer, PC_MEDIA_PLAYER_VERSION } from '../scripts/pc-media-player.js';

function file(name = 'track.mp3', type = 'audio/mpeg', size = 1024) {
  return { name, type, size, arrayBuffer: async () => new ArrayBuffer(size) };
}

function host({ play = async () => {}, random = () => 0.25 } = {}) {
  const audio = { currentTime: 0, duration: 120, src: '', play: jest.fn(play), pause: jest.fn() };
  const urls = { createObjectURL: jest.fn(() => `blob:${urls.createObjectURL.mock.calls.length}`), revokeObjectURL: jest.fn() };
  const player = createPcMediaPlayer({ audioFactory: () => audio, urlApi: urls, random });
  return { audio, urls, player };
}

describe('PC browser media host', () => {
  test('refuses unavailable hosts and invalid files without filesystem access', async () => {
    const unsupported = createPcMediaPlayer({ audioFactory: () => null, urlApi: null });
    expect(unsupported.read()).toMatchObject({ version: PC_MEDIA_PLAYER_VERSION, state: 'unsupported' });
    expect(unsupported.command('add', file())).toMatchObject({ state: 'unsupported' });
    expect(unsupported.command('load', 0)).toMatchObject({ state: 'unsupported', reason: 'browser audio host is unavailable' });
    expect(unsupported.command('seek', 4)).toMatchObject({ state: 'refused' });
    await expect(unsupported.play()).resolves.toMatchObject({ state: 'unsupported' });
    expect(unsupported.pause()).toMatchObject({ state: 'unsupported' });
    expect(unsupported.command('ended')).toMatchObject({ state: 'unsupported' });
    expect(unsupported.dispose()).toEqual({ version: PC_MEDIA_PLAYER_VERSION, state: 'disposed' });
    const noUrl = createPcMediaPlayer({ audioFactory: () => ({ play: jest.fn(), pause: jest.fn() }), urlApi: null });
    expect(noUrl.command('load', 0)).toMatchObject({ state: 'unsupported', reason: 'browser object URL host is unavailable' });
    const defaultHost = createPcMediaPlayer();
    expect(defaultHost.read()).toMatchObject({ state: 'unsupported' });
    const noAudioHost = createPcMediaPlayer({ urlApi: null });
    expect(noAudioHost.read()).toMatchObject({ state: 'unsupported' });
    const audio = { currentTime: 0, duration: 1, play: jest.fn(), pause: jest.fn() };
    const previousAudio = globalThis.Audio;
    globalThis.Audio = jest.fn(() => audio);
    try {
      expect(createPcMediaPlayer({ urlApi: null }).read()).toMatchObject({ state: 'unsupported' });
    } finally {
      globalThis.Audio = previousAudio;
    }
    expect(() => createPcMediaPlayer({ audioFactory: null })).toThrow('factory');
    expect(() => createPcMediaPlayer({ random: null })).toThrow('random');
    const { player } = host();
    expect(player.command('add', null)).toMatchObject({ state: 'refused' });
    expect(player.command('add', { type: 'audio/mpeg', size: 1, arrayBuffer: async () => new ArrayBuffer(1) })).toMatchObject({ state: 'refused' });
    expect(player.command('add', { name: 'track.txt', type: 'text/plain', size: 1, arrayBuffer: async () => new ArrayBuffer(1) })).toMatchObject({ state: 'refused' });
    expect(player.command('add', { name: 'track.mp3', type: '', size: -1, arrayBuffer: async () => new ArrayBuffer(0) })).toMatchObject({ state: 'refused' });
    expect(player.command('next')).toMatchObject({ state: 'refused' });
  });

  test('queues, plays, seeks, navigates, repeats, and disposes local tracks', async () => {
    const { audio, urls, player } = host();
    expect(player.read()).toMatchObject({ state: 'idle', queue: [], currentIndex: -1, current: null });
    expect(player.command('add', file('one.mp3'))).toMatchObject({ state: 'idle', currentIndex: 0, current: { name: 'one.mp3' } });
    expect(player.command('add', file('two.ogg', ''))).toMatchObject({ queue: [{ name: 'one.mp3' }, { name: 'two.ogg', type: null }] });
    expect(player.command('load', 0)).toMatchObject({ current: { name: 'one.mp3' } });
    expect(urls.createObjectURL).toHaveBeenCalledTimes(1);
    expect(player.command('load', 99)).toMatchObject({ state: 'refused' });
    await expect(player.play()).resolves.toMatchObject({ state: 'playing' });
    await expect(player.play()).resolves.toMatchObject({ state: 'playing' });
    expect(audio.play).toHaveBeenCalled();
    expect(player.pause()).toMatchObject({ state: 'paused' });
    expect(player.command('pause')).toMatchObject({ state: 'paused' });
    expect(player.command('seek', 42)).toMatchObject({ positionSeconds: 42 });
    expect(player.command('seek', -1)).toMatchObject({ state: 'refused' });
    expect(player.command('shuffle', true)).toMatchObject({ shuffle: true });
    expect(player.command('next')).toMatchObject({ currentIndex: 1 });
    expect(player.command('previous')).toMatchObject({ currentIndex: 0 });
    expect(player.command('repeat', 'all')).toMatchObject({ repeat: 'all' });
    expect(player.command('previous')).toMatchObject({ currentIndex: 1 });
    expect(player.command('next')).toMatchObject({ currentIndex: 0 });
    expect(player.command('next')).toMatchObject({ currentIndex: 1 });
    expect(player.command('next')).toMatchObject({ currentIndex: 0 });
    expect(player.command('repeat', 'one')).toMatchObject({ repeat: 'one' });
    expect(player.command('ended')).toMatchObject({ state: 'replay-required' });
    audio.onended();
    await new Promise((resolve) => setImmediate(resolve));
    expect(audio.play.mock.calls.length).toBeGreaterThan(1);
    expect(player.command('repeat', 'off')).toMatchObject({ repeat: 'off' });
    expect(player.command('shuffle', false)).toMatchObject({ shuffle: false });
    expect(player.command('load', 0)).toMatchObject({ currentIndex: 0 });
    audio.onended();
    expect(player.read()).toMatchObject({ state: 'loaded', currentIndex: 1 });
    expect(player.command('repeat', 'all')).toMatchObject({ repeat: 'all' });
    expect(player.command('load', 1)).toMatchObject({ currentIndex: 1 });
    expect(player.command('next')).toMatchObject({ currentIndex: 0 });
    expect(player.command('load', 0)).toMatchObject({ currentIndex: 0 });
    expect(player.command('repeat', 'off')).toMatchObject({ repeat: 'off' });
    expect(player.command('ended')).toMatchObject({ state: 'loaded', currentIndex: 1 });
    expect(player.command('ended')).toMatchObject({ state: 'ended', currentIndex: 1 });
    audio.onended();
    expect(audio.play.mock.calls.length).toBeGreaterThan(1);
    expect(() => player.command('repeat', 'invalid')).toThrow('repeat mode');
    expect(() => player.command('unknown')).toThrow('Unsupported');
    expect(() => player.command('')).toThrow('unknown');
    expect(player.dispose()).toEqual({ version: PC_MEDIA_PLAYER_VERSION, state: 'disposed' });
    expect(urls.revokeObjectURL).toHaveBeenCalled();
    expect(player.read()).toMatchObject({ state: 'idle', queue: [], currentIndex: -1 });
  });

  test('handles shuffle fallback, previous boundaries, playback rejection, and queue bounds', async () => {
    const { player } = host({ random: () => 2 });
    player.command('add', file('one.wav', ''));
    player.command('add', file('two.flac', ''));
    expect(player.command('shuffle', true)).toMatchObject({ shuffle: true });
    expect(player.command('previous')).toMatchObject({ state: 'refused' });
    expect(player.command('next')).toMatchObject({ currentIndex: 1 });
    player.command('shuffle', false);
    expect(player.command('load', 0)).toMatchObject({ currentIndex: 0 });
    expect(player.command('previous')).toMatchObject({ state: 'refused' });
    const rejected = host({ play: async () => { throw new Error('autoplay denied'); } });
    rejected.player.command('add', file());
    await expect(rejected.player.play()).resolves.toMatchObject({ state: 'rejected', reason: 'autoplay denied' });
    const fallback = host({ play: async () => { throw {}; } });
    fallback.player.command('add', file());
    await expect(fallback.player.play()).resolves.toMatchObject({ state: 'rejected', reason: 'browser audio playback was rejected' });
    const replayRejected = host({ play: async () => { throw new Error('replay denied'); } });
    replayRejected.player.command('add', file());
    replayRejected.player.command('repeat', 'one');
    replayRejected.audio.onended();
    await new Promise((resolve) => setImmediate(resolve));
    const empty = host().player;
    await expect(empty.command('play')).resolves.toMatchObject({ state: 'refused' });
    for (let index = 0; index < 256; index += 1) player.command('add', file(`track-${index}.mp3`));
    expect(player.command('add', file('overflow.mp3'))).toMatchObject({ state: 'refused', reason: 'media queue is full' });
  });
});
