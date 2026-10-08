/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded read-only media metadata authority. It validates one local media
 * file and invokes only ffprobe through the shell-free command runner.
 */

import fs from 'fs/promises';
import path from 'path';

export const MEDIA_METADATA_VERSION = 1;
const EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.wma', '.avi', '.m4v', '.mkv', '.mov', '.mp4', '.webm', '.wmv']);
const FFMPEG_ARGS = Object.freeze(['-v', 'error', '-show_entries', 'format=duration,format_name,size:stream=codec_type,codec_name,width,height,channels,sample_rate', '-of', 'json']);

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function number(value) { const parsed = typeof value === 'string' && value.trim() ? Number(value) : value; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function localPath(value) { const candidate = text(value); return candidate && !/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : null; }
function normalizeStream(stream) {
  return Object.freeze({ type: text(stream.codec_type) || 'unknown', codec: text(stream.codec_name), width: number(stream.width), height: number(stream.height), channels: number(stream.channels), sampleRate: number(stream.sample_rate) });
}

export function buildMediaMetadataPlan(filePath, { pathImpl = path } = {}) {
  const candidate = localPath(filePath);
  if (!candidate) return Object.freeze({ version: MEDIA_METADATA_VERSION, state: 'refused', reason: 'local media file path is required' });
  const resolved = pathImpl.resolve(candidate);
  if (!EXTENSIONS.has(pathImpl.extname(resolved).toLowerCase())) return Object.freeze({ version: MEDIA_METADATA_VERSION, state: 'refused', path: resolved, reason: 'media file extension is not supported' });
  return Object.freeze({ version: MEDIA_METADATA_VERSION, state: 'plan-ready', path: resolved, operation: 'inspect-media-metadata', command: Object.freeze({ file: 'ffprobe', args: Object.freeze([...FFMPEG_ARGS, '--', resolved]) }), mutation: 'none', requiresApproval: false });
}

export function parseMediaMetadataOutput(output, { path: filePath } = {}) {
  let parsed;
  try { parsed = JSON.parse(String(output || '')); } catch { return Object.freeze({ version: MEDIA_METADATA_VERSION, available: false, path: text(filePath), reason: 'ffprobe returned invalid JSON' }); }
  if (!record(parsed)) return Object.freeze({ version: MEDIA_METADATA_VERSION, available: false, path: text(filePath), reason: 'ffprobe returned an invalid record' });
  const format = record(parsed.format) ? parsed.format : {};
  const streams = Array.isArray(parsed.streams) ? parsed.streams.filter(record).slice(0, 16).map(normalizeStream) : [];
  return Object.freeze({ version: MEDIA_METADATA_VERSION, available: true, path: text(filePath), format: Object.freeze({ name: text(format.format_name), durationSeconds: number(format.duration), sizeBytes: number(format.size) }), streams: Object.freeze(streams), source: 'ffprobe' });
}

export async function collectMediaMetadata(filePath, { fsImpl = fs, pathImpl = path, commandRunner, maxOutputBytes = 32768 } = {}) {
  const plan = buildMediaMetadataPlan(filePath, { pathImpl });
  if (plan.state !== 'plan-ready') return Object.freeze({ ...plan, available: false });
  if (!commandRunner || typeof commandRunner.run !== 'function') return Object.freeze({ ...plan, available: false, reason: 'command runner unavailable' });
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 262144) throw new RangeError('Media metadata output bound is out of range');
  let info;
  try { info = await fsImpl.lstat(plan.path); } catch (error) { return Object.freeze({ ...plan, available: false, reason: error.message }); }
  if (info.isSymbolicLink?.()) return Object.freeze({ ...plan, available: false, reason: 'symbolic links are not metadata targets' });
  if (!info.isFile?.()) return Object.freeze({ ...plan, available: false, reason: 'metadata target is not a regular file' });
  try {
    const result = await commandRunner.run(plan.command.file, plan.command.args, { timeoutMs: 5000, maxOutputBytes });
    if (result?.code !== 0) return Object.freeze({ ...plan, available: false, reason: result?.stderr || 'ffprobe failed' });
    return parseMediaMetadataOutput(result.stdout, { path: plan.path });
  } catch (error) { return Object.freeze({ ...plan, available: false, reason: error.message }); }
}
