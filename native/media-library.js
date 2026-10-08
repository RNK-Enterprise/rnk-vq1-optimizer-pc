/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded local media catalogue and playlist state. Media files are read-only;
 * this module stores only explicit library metadata and never moves or deletes
 * a media file.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const MEDIA_LIBRARY_VERSION = 1;
const MEDIA_EXTENSIONS = Object.freeze({
  audio: Object.freeze(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.wma']),
  video: Object.freeze(['.avi', '.m4v', '.mkv', '.mov', '.mp4', '.webm', '.wmv']),
  image: Object.freeze(['.gif', '.jpeg', '.jpg', '.png', '.webp'])
});
const ALL_EXTENSIONS = new Map(Object.entries(MEDIA_EXTENSIONS).flatMap(([type, extensions]) => extensions.map((extension) => [extension, type])));

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function bounded(value, limit) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, limit) : []; }
function number(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function requireRoot(value) { const root = text(value); if (!root) throw new TypeError('Media library requires an explicit root'); return root; }
function titleOf(name) { return path.basename(name, path.extname(name)).replace(/[._-]+/g, ' ').trim() || 'untitled'; }

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try { for (;;) { const buffer = Buffer.allocUnsafe(1024 * 1024); const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); } } finally { await handle.close(); }
  return hash.digest('hex');
}

async function walk(root, options, state, depth = 0) {
  if (depth > options.maxDepth || state.items.length >= options.maxEntries) return;
  let entries;
  try { entries = await options.fsImpl.readdir(root, { withFileTypes: true }); } catch { state.unreadableRoots += 1; return; }
  for (const entry of entries) {
    if (state.items.length >= options.maxEntries) break;
    const filePath = options.pathImpl.join(root, entry.name);
    if (entry.isSymbolicLink?.()) { state.symlinkCount += 1; continue; }
    if (entry.isDirectory?.()) { await walk(filePath, options, state, depth + 1); continue; }
    if (!entry.isFile?.()) continue;
    const extension = options.pathImpl.extname(entry.name).toLowerCase();
    const type = ALL_EXTENSIONS.get(extension);
    if (!type) continue;
    let info;
    try { info = await options.fsImpl.stat(filePath); } catch { state.raceCount += 1; continue; }
    const sizeBytes = number(info.size) || 0;
    let sha256 = null;
    if (options.hashFiles && sizeBytes <= options.maxHashBytes) { try { sha256 = String(await options.hashFileImpl(filePath)).toLowerCase(); } catch { sha256 = null; } }
    state.items.push(Object.freeze({ path: filePath, title: titleOf(entry.name), type, extension, sizeBytes, modifiedAt: Number.isFinite(info.mtimeMs) ? new Date(info.mtimeMs).toISOString() : null, sha256 }));
  }
}

export async function scanMediaRoot(root, { fsImpl = fs, pathImpl = path, maxEntries = 1024, maxDepth = 3, hashFiles = false, maxHashBytes = 256 * 1024 ** 2, hashFileImpl = hashFile } = {}) {
  const resolvedRoot = requireRoot(root);
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10000) throw new RangeError('Media library maxEntries is out of range');
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 8) throw new RangeError('Media library maxDepth is out of range');
  if (!Number.isFinite(maxHashBytes) || maxHashBytes < 0) throw new RangeError('Media library maxHashBytes is invalid');
  const state = { items: [], symlinkCount: 0, raceCount: 0, unreadableRoots: 0 };
  await walk(resolvedRoot, { fsImpl, pathImpl, maxEntries, maxDepth, hashFiles: hashFiles === true, maxHashBytes, hashFileImpl }, state);
  const grouped = new Map();
  state.items.forEach((item) => { if (item.sha256) grouped.set(item.sha256, [...(grouped.get(item.sha256) || []), item.path]); });
  const duplicates = [...grouped.entries()].filter(([, paths]) => paths.length > 1).map(([sha256, paths]) => Object.freeze({ sha256, paths: Object.freeze(paths) }));
  return Object.freeze({ version: MEDIA_LIBRARY_VERSION, root: resolvedRoot, itemCount: state.items.length, truncated: state.items.length >= maxEntries, items: Object.freeze(state.items), duplicates: Object.freeze(duplicates), symlinkCount: state.symlinkCount, raceCount: state.raceCount, unreadableRoots: state.unreadableRoots, mutation: 'none' });
}

function emptyState() { return { version: MEDIA_LIBRARY_VERSION, favorites: [], recent: [], playlists: {}, lastPlayedAt: null }; }
function validateState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const playlists = source.playlists && typeof source.playlists === 'object' && !Array.isArray(source.playlists) ? Object.fromEntries(Object.entries(source.playlists).slice(0, 128).map(([name, tracks]) => [name, bounded(tracks, 256)])) : {};
  return { version: MEDIA_LIBRARY_VERSION, favorites: bounded(source.favorites, 256), recent: bounded(source.recent, 256), playlists, lastPlayedAt: Number.isFinite(source.lastPlayedAt) ? source.lastPlayedAt : null };
}

export function createMediaLibrary({ filePath, fsImpl = fs, now = Date.now } = {}) {
  const statePath = text(filePath);
  if (!statePath) throw new TypeError('Media library requires a state file path');
  if (typeof now !== 'function') throw new TypeError('Media library clock must be a function');
  async function read() { try { const raw = await fsImpl.readFile(statePath, 'utf8'); if (raw.length > 1024 * 1024) throw new RangeError('Media library state is too large'); return validateState(JSON.parse(raw)); } catch (error) { if (error?.code === 'ENOENT') return emptyState(); throw error; } }
  async function write(next) { const normalized = validateState(next); await fsImpl.mkdir(path.dirname(statePath), { recursive: true }); await fsImpl.writeFile(statePath, JSON.stringify(normalized, null, 2), 'utf8'); return normalized; }
  async function update(mutator) { const current = await read(); const next = await mutator(current); return write(next); }
  return Object.freeze({
    version: MEDIA_LIBRARY_VERSION,
    scan: scanMediaRoot,
    read,
    write,
    favorite: (filePath, enabled = true) => update((current) => ({ ...current, favorites: enabled ? [...new Set([...current.favorites, filePath])].slice(0, 256) : current.favorites.filter((item) => item !== filePath) })),
    played: (filePath) => update((current) => ({ ...current, recent: [filePath, ...current.recent.filter((item) => item !== filePath)].slice(0, 256), lastPlayedAt: now() })),
    playlist: (name, tracks) => { const playlistName = text(name); if (!playlistName) throw new TypeError('Media playlist requires a name'); return update((current) => ({ ...current, playlists: { ...current.playlists, [playlistName]: bounded(tracks, 256) } })); },
    exportPlaylist: async (name) => { const current = await read(); const tracks = current.playlists[text(name)] || []; return JSON.stringify({ version: MEDIA_LIBRARY_VERSION, name: text(name), tracks }); },
    importPlaylist: async (serialized) => { const parsed = JSON.parse(String(serialized || '')); return update((current) => ({ ...current, playlists: { ...current.playlists, [text(parsed.name) || 'Imported playlist']: bounded(parsed.tracks, 256) } })); },
    playbackPlan: (filePath) => Object.freeze({ state: text(filePath) ? 'review-ready' : 'refused', path: text(filePath), operation: 'play-local-media', authority: 'player-host-required', mutation: 'none' })
  });
}
