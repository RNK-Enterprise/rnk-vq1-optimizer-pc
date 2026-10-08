/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Approved local-media playback authority. The native layer validates one
 * existing media file and invokes only the platform's fixed default-player
 * opener through the shell-free command runner.
 */

import fs from 'fs/promises';
import path from 'path';

export const MEDIA_PLAYBACK_VERSION = 1;
const EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.wma', '.avi', '.m4v', '.mkv', '.mov', '.mp4', '.webm', '.wmv']);
const OPENERS = Object.freeze({
  win32: Object.freeze({ file: 'explorer.exe' }),
  linux: Object.freeze({ file: 'xdg-open' }),
  darwin: Object.freeze({ file: 'open' })
});

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function localPath(value) {
  const candidate = text(value);
  if (!candidate || /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return null;
  return candidate;
}
function openerFor(platform) { return OPENERS[text(platform)?.toLowerCase()] || null; }

export function buildMediaPlaybackPlan(filePath, { platform = process.platform, pathImpl = path } = {}) {
  const candidate = localPath(filePath);
  if (!candidate) return Object.freeze({ version: MEDIA_PLAYBACK_VERSION, state: 'refused', reason: 'local media file path is required' });
  const resolved = pathImpl.resolve(candidate);
  if (!EXTENSIONS.has(pathImpl.extname(resolved).toLowerCase())) return Object.freeze({ version: MEDIA_PLAYBACK_VERSION, state: 'refused', path: resolved, reason: 'media file extension is not supported' });
  const opener = openerFor(platform);
  if (!opener) return Object.freeze({ version: MEDIA_PLAYBACK_VERSION, state: 'unsupported-platform', platform, path: resolved, reason: 'platform default-player opener is unavailable' });
  return Object.freeze({ version: MEDIA_PLAYBACK_VERSION, state: 'plan-ready', platform: text(platform)?.toLowerCase(), path: resolved, operation: 'play-local-media', command: Object.freeze({ file: opener.file, args: Object.freeze([resolved]) }), requiresApproval: true, mutation: 'none' });
}

export async function applyMediaPlayback(plan, { fsImpl = fs, commandRunner, approved = false, dryRun = true } = {}) {
  if (!record(plan) || plan.version !== MEDIA_PLAYBACK_VERSION || plan.operation !== 'play-local-media') throw new TypeError('Media playback plan is invalid');
  if (!commandRunner || typeof commandRunner.run !== 'function') throw new TypeError('Media playback requires a command runner');
  if (plan.state !== 'plan-ready') return Object.freeze({ state: 'refused', applied: false, reason: plan.reason || 'media playback plan is not ready' });
  if (!approved) return Object.freeze({ state: 'approval-required', applied: false, path: plan.path });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, path: plan.path });
  let info;
  try { info = await fsImpl.lstat(plan.path); } catch (error) { return Object.freeze({ state: 'rejected', applied: false, path: plan.path, reason: error.message }); }
  if (info.isSymbolicLink?.()) return Object.freeze({ state: 'rejected', applied: false, path: plan.path, reason: 'symbolic links are not playable targets' });
  if (!info.isFile?.()) return Object.freeze({ state: 'rejected', applied: false, path: plan.path, reason: 'media target is not a regular file' });
  try {
    const result = await commandRunner.run(plan.command.file, plan.command.args, { timeoutMs: 5000, maxOutputBytes: 1024 });
    return Object.freeze(result?.code === 0 ? { state: 'applied', applied: true, path: plan.path, command: plan.command.file } : { state: 'rejected', applied: false, path: plan.path, reason: result?.stderr || 'default-player opener failed' });
  } catch (error) { return Object.freeze({ state: 'rejected', applied: false, path: plan.path, reason: error.message }); }
}
