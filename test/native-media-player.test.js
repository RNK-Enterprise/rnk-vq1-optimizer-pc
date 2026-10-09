/**
 * Native media player tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { buildMediaPanelPlan, createMediaPlayer, MEDIA_PLAYER_VERSION, REPEAT_MODES } from '../native/media-player.js';

describe('native media player state', () => {
  test('supports queue controls, search, and explicit host authority', () => {
    const player = createMediaPlayer({ queue: ['/music/a.mp3', '/music/a.mp3', '/music/b.mp3'], now: () => 10, random: () => 0 });
    expect(REPEAT_MODES).toEqual(['off', 'one', 'all']);
    expect(player.read()).toMatchObject({ version: MEDIA_PLAYER_VERSION, queue: ['/music/a.mp3', '/music/b.mp3'], track: '/music/a.mp3', playing: false, authority: 'player-host-required' });
    expect(player.command('play')).toMatchObject({ playing: true });
    expect(player.command('next')).toMatchObject({ currentIndex: 1, track: '/music/b.mp3' });
    expect(player.command('previous')).toMatchObject({ currentIndex: 0 });
    expect(player.command('shuffle', true)).toMatchObject({ shuffle: true });
    expect(player.command('repeat', 'all')).toMatchObject({ repeat: 'all' });
    expect(player.command('next')).toMatchObject({ currentIndex: 1 });
    expect(player.command('select', 0)).toMatchObject({ currentIndex: 0 });
    expect(player.search([{ title: 'Morning', path: '/music/a.mp3' }, { title: 'Night', path: '/music/n.mp3' }], 'morning')).toHaveLength(1);
    expect(player.search(null, '')).toEqual([]);
    expect(player.search([null, {}])).toEqual([{}]);
    expect(player.search([{}], 'missing')).toEqual([]);
  });

  test('refuses empty queues and invalid commands or indexes', () => {
    const player = createMediaPlayer({ queue: [], now: () => 1 });
    expect(player.command('play')).toMatchObject({ playing: false, track: null });
    expect(player.command('next')).toMatchObject({ playing: false });
    expect(player.command('pause')).toMatchObject({ playing: false });
    expect(() => player.command('repeat', 'bad')).toThrow('repeat mode');
    expect(() => player.command('select', 0)).toThrow('track index');
    expect(() => player.command('unknown')).toThrow('Unsupported');
    expect(() => player.command()).toThrow('unknown');
    expect(() => createMediaPlayer({ now: 1 })).toThrow('clock');
    expect(createMediaPlayer().read()).toMatchObject({ queue: [], track: null });
  });

  test('handles repeat-one, repeat-all, previous boundary, and panel URL policy', () => {
    const player = createMediaPlayer({ queue: ['/a', '/b'], initial: { currentIndex: 1 }, now: () => 1 });
    expect(player.command('repeat', 'one')).toMatchObject({ currentIndex: 1 });
    expect(player.command('next')).toMatchObject({ currentIndex: 1 });
    expect(player.command('repeat', 'all')).toMatchObject({ repeat: 'all' });
    expect(player.command('next')).toMatchObject({ currentIndex: 0 });
    expect(player.command('previous')).toMatchObject({ currentIndex: 1 });
    expect(createMediaPlayer({ queue: ['/a'], initial: { currentIndex: 0 }, now: () => 1 }).command('previous')).toMatchObject({ currentIndex: 0, playing: false });
    expect(buildMediaPanelPlan()).toMatchObject({ state: 'refused', reason: 'media-panel URL is required' });
    expect(buildMediaPanelPlan('bad')).toMatchObject({ state: 'refused', reason: 'media-panel URL is invalid' });
    expect(buildMediaPanelPlan('http://www.youtube.com/watch?v=x')).toMatchObject({ state: 'refused', reason: 'media-panel requires HTTPS' });
    expect(buildMediaPanelPlan('https://example.com/media')).toMatchObject({ state: 'refused', reason: 'media-panel host is not allow-listed' });
    expect(buildMediaPanelPlan('https://www.youtube.com/watch?v=x')).toMatchObject({ state: 'review-ready', downloads: false, requiresApproval: true });
    expect(buildMediaPanelPlan('https://example.com/media', { allowedHosts: ['example.com'] })).toMatchObject({ state: 'review-ready' });
    expect(buildMediaPanelPlan('https://example.com/media', { allowedHosts: 'bad' })).toMatchObject({ state: 'refused', reason: 'media-panel host is not allow-listed' });
  });

  test('uses shuffle selection for next-track behavior and fails closed for invalid random samples', () => {
    const player = createMediaPlayer({ queue: ['/a', '/b', '/c'], random: () => 0.99, now: () => 1 });
    player.command('shuffle', true);
    expect(player.command('next')).toMatchObject({ currentIndex: 2, track: '/c' });
    const fallback = createMediaPlayer({ queue: ['/a', '/b'], random: () => 2, now: () => 1 });
    fallback.command('shuffle', true);
    expect(fallback.command('next')).toMatchObject({ currentIndex: 1, track: '/b' });
    expect(() => createMediaPlayer({ random: 1 })).toThrow('random source');
  });
});
