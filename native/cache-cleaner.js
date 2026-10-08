/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/gpl-3.0.html>.
 *
 * Only generated cache roots are eligible. Symlinks are never followed, the
 * root itself is never removed, and cleanup requires explicit approval.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const EMPTY_ROOTS = Object.freeze([]);

function isInside(root, candidate, pathImpl) {
  const relative = pathImpl.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !pathImpl.isAbsolute(relative);
}

function uniqueRoots(roots, pathImpl) {
  return [...new Set(roots.filter((root) => typeof root === 'string' && root.length > 0).map((root) => pathImpl.resolve(root)))];
}

export function defaultCacheRoots({ platform = process.platform, env = process.env, osImpl = os, pathImpl = path } = {}) {
  const temp = typeof osImpl.tmpdir === 'function' ? osImpl.tmpdir() : null;
  const home = env.HOME || env.USERPROFILE || null;
  const localAppData = env.LOCALAPPDATA || null;
  const roots = {
    'user-temp': temp ? [pathImpl.join(temp, 'rnk-vortex-optimizer')] : EMPTY_ROOTS,
    'shader-cache': platform === 'win32'
      ? [localAppData && pathImpl.join(localAppData, 'D3DSCache'), localAppData && pathImpl.join(localAppData, 'NVIDIA', 'DXCache'), localAppData && pathImpl.join(localAppData, 'NVIDIA', 'GLCache')]
      : platform === 'linux'
        ? [home && pathImpl.join(home, '.cache', 'mesa_shader_cache'), home && pathImpl.join(home, '.cache', 'nvidia', 'GLCache')]
        : EMPTY_ROOTS,
    'app-cache': EMPTY_ROOTS
  };
  return Object.fromEntries(Object.entries(roots).map(([key, values]) => [key, uniqueRoots(values, pathImpl)]));
}

export function createCacheCleaner({
  fsImpl = fs,
  osImpl = os,
  env = process.env,
  pathImpl = path,
  now = () => Date.now()
} = {}) {
  const rootsFor = (target, platform) => defaultCacheRoots({ platform, env, osImpl, pathImpl })[target] || EMPTY_ROOTS;

  async function walk(root, cutoff, maxEntries, items, depth = 0) {
    if (items.length >= maxEntries || depth > 2) return;
    let entries;
    try {
      entries = await fsImpl.readdir(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (items.length >= maxEntries) break;
      const candidate = pathImpl.join(root, entry.name);
      let info;
      try {
        info = await fsImpl.lstat(candidate);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) continue;
      if (info.mtimeMs > cutoff) {
        if (info.isDirectory()) await walk(candidate, cutoff, maxEntries, items, depth + 1);
        continue;
      }
      items.push({
        path: candidate,
        kind: info.isDirectory() ? 'directory' : 'file',
        sizeBytes: info.isFile() ? info.size : null,
        modifiedAt: new Date(info.mtimeMs).toISOString()
      });
    }
  }

  async function preview({ target = 'user-temp', platform = process.platform, maxAgeHours = 24, maxEntries = 2000 } = {}) {
    if (!Number.isFinite(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 24 * 365) {
      throw new RangeError('maxAgeHours must be between 1 and 8760');
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10000) {
      throw new RangeError('maxEntries must be between 1 and 10000');
    }
    const roots = rootsFor(target, platform);
    const cutoff = now() - maxAgeHours * 60 * 60 * 1000;
    const items = [];
    for (const root of roots) await walk(root, cutoff, maxEntries, items);
    return { target, platform, roots, maxAgeHours, items, truncated: items.length >= maxEntries };
  }

  async function clean(previewResult, { approved = false, dryRun = true } = {}) {
    if (!previewResult || !Array.isArray(previewResult.items) || !Array.isArray(previewResult.roots)) {
      throw new TypeError('Cleanup requires a preview result');
    }
    if (!approved && !dryRun) throw new Error('Cleanup requires explicit approval');
    if (dryRun) return { dryRun: true, removed: [], skipped: previewResult.items.length };
    const removed = [];
    const skipped = [];
    for (const item of [...previewResult.items].sort((a, b) => b.path.length - a.path.length)) {
      const root = previewResult.roots.find((candidate) => isInside(candidate, item.path, pathImpl));
      if (!root) {
        skipped.push({ path: item.path, reason: 'outside-approved-root' });
        continue;
      }
      try {
        const info = await fsImpl.lstat(item.path);
        if (info.isSymbolicLink()) {
          skipped.push({ path: item.path, reason: 'symlink' });
          continue;
        }
        await fsImpl.rm(item.path, { recursive: info.isDirectory(), force: false });
        removed.push(item.path);
      } catch (error) {
        skipped.push({ path: item.path, reason: error.message });
      }
    }
    return { dryRun: false, removed, skipped };
  }

  return { rootsFor, preview, clean };
}
