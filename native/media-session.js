/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Local media session orchestration. Queue state remains deterministic while
 * playback is delegated to the existing fixed platform opener authority.
 */

import { createCommandRunner } from './command-runner.js';
import { createMediaPlayer } from './media-player.js';
import { applyMediaPlayback, buildMediaPlaybackPlan } from './media-playback.js';
import path from 'path';

export const MEDIA_SESSION_VERSION = 1;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }

export function createMediaSession({
  queue = [],
  initial = {},
  platform = process.platform,
  pathImpl = path,
  commandRunner = createCommandRunner(),
  fsImpl,
  approved = false,
  dryRun = true,
  now = Date.now,
  random = Math.random
} = {}) {
  const player = createMediaPlayer({ queue, initial, now, random });

  async function play() {
    const before = player.read();
    if (!before.track) return Object.freeze({ version: MEDIA_SESSION_VERSION, state: 'refused', player: before, reason: 'media queue has no selected track' });
    const plan = buildMediaPlaybackPlan(before.track, { platform, pathImpl });
    if (plan.state !== 'plan-ready') return Object.freeze({ version: MEDIA_SESSION_VERSION, state: 'refused', player: before, plan, reason: plan.reason });
    const result = await applyMediaPlayback(plan, { commandRunner, fsImpl, approved, dryRun });
    if (result.state === 'applied') player.command('play');
    return Object.freeze({ version: MEDIA_SESSION_VERSION, state: result.state, player: player.read(), plan, result });
  }

  async function command(action, value) {
    if (action === 'play') return play();
    return Object.freeze({ version: MEDIA_SESSION_VERSION, state: 'state-updated', player: player.command(action, value), playback: null });
  }

  function read() {
    return Object.freeze({ version: MEDIA_SESSION_VERSION, player: player.read(), authority: 'local-default-player', mutation: 'approved-local-playback-only' });
  }

  return Object.freeze({ version: MEDIA_SESSION_VERSION, read, command, play });
}

export function mediaSessionTrack(value) { return text(value); }
