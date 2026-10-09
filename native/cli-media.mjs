/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Native CLI media catalogue, playback, and local player commands.
 */

import { createCommandRunner } from './command-runner.js';
import { scanMediaRoot } from './media-library.js';
import { buildMediaPanelPlan, createMediaPlayer } from './media-player.js';
import { createMediaSession } from './media-session.js';
import { applyMediaPlayback, buildMediaPlaybackPlan } from './media-playback.js';
import { applyMediaPanelOpen, buildMediaPanelOpenPlan } from './media-panel.js';
import { collectMediaMetadata } from './media-metadata.js';
import { mediaLibraryFromArgs, numberOption, requireOption } from './cli-utils.mjs';

export async function runMediaCommand(command, args) {
  if (command === 'media-scan') {
    return scanMediaRoot(requireOption(args, 'root'), {
      maxEntries: numberOption(args, 'max-entries', 1024),
      maxDepth: numberOption(args, 'max-depth', 3),
      maxHashBytes: numberOption(args, 'max-hash-bytes', 256 * 1024 ** 2),
      hashFiles: args['hash-files'] === true
    });
  }
  if (command === 'media-play') {
    const plan = buildMediaPlaybackPlan(requireOption(args, 'file'), { platform: process.platform });
    if (args.confirm !== true) throw new Error('media-play requires --confirm');
    return { plan, result: await applyMediaPlayback(plan, { commandRunner: createCommandRunner(), approved: true, dryRun: false }) };
  }
  if (command === 'media-panel-open') {
    const plan = buildMediaPanelOpenPlan(requireOption(args, 'url'), { platform: process.platform });
    if (args.confirm !== true) throw new Error('media-panel-open requires --confirm');
    return { plan, result: await applyMediaPanelOpen(plan, { commandRunner: createCommandRunner(), approved: true, dryRun: false }) };
  }
  if (command === 'media-metadata') return collectMediaMetadata(requireOption(args, 'file'), { commandRunner: createCommandRunner(), maxOutputBytes: numberOption(args, 'max-output-bytes', 32768) });
  const library = mediaLibraryFromArgs(args);
  if (command === 'media-read') return library.read();
  if (command === 'media-favorite') return library.favorite(requireOption(args, 'file'), args.disable !== true);
  if (command === 'media-played') return library.played(requireOption(args, 'file'));
  if (command === 'media-playlist') return library.playlist(requireOption(args, 'name'), JSON.parse(requireOption(args, 'tracks')));
  if (command === 'media-export') return JSON.parse(await library.exportPlaylist(requireOption(args, 'name')));
  if (command === 'media-import') return library.importPlaylist(requireOption(args, 'playlist'));
  if (command === 'media-playback-plan') return library.playbackPlan(requireOption(args, 'file'));
  throw new Error(`Unknown media command: ${command}`);
}

export async function runMediaPlayerCommand(args) {
  const queue = JSON.parse(requireOption(args, 'tracks'));
  if (args.action === 'play') {
    const session = createMediaSession({
      queue,
      initial: typeof args.initial === 'string' ? JSON.parse(args.initial) : {},
      platform: process.platform,
      commandRunner: createCommandRunner(),
      approved: args.confirm === true,
      dryRun: args.confirm !== true
    });
    return session.play();
  }
  const player = createMediaPlayer({ queue, initial: typeof args.initial === 'string' ? JSON.parse(args.initial) : {} });
  const action = args.action || 'read';
  if (action === 'read') return player.read();
  const value = action === 'select' ? numberOption(args, 'index', null) : action === 'shuffle' ? args.enabled === true : action === 'repeat' ? requireOption(args, 'mode') : undefined;
  return player.command(action, value);
}

export { buildMediaPanelPlan };
