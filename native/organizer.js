/**
 * RNK Vortex System Optimizer
 * Copyright © 2025 Asgard Innovations / RNK™
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
 * Organization is never part of automatic optimization. It produces a
 * preview first, moves only inside the selected root, never overwrites, and
 * records enough information for rollback.
 */

import fs from 'fs/promises';
import path from 'path';

const CATEGORY_EXTENSIONS = Object.freeze({
  documents: new Set(['.doc', '.docx', '.md', '.odt', '.pdf', '.rtf', '.txt']),
  images: new Set(['.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']),
  video: new Set(['.avi', '.m4v', '.mkv', '.mov', '.mp4', '.webm']),
  audio: new Set(['.flac', '.m4a', '.mp3', '.ogg', '.wav']),
  archives: new Set(['.7z', '.bz2', '.gz', '.rar', '.tar', '.zip']),
  code: new Set(['.c', '.cpp', '.css', '.go', '.h', '.html', '.js', '.json', '.py', '.rs', '.sh', '.ts', '.yaml', '.yml'])
});

function categoryFor(filePath, pathImpl) {
  const extension = pathImpl.extname(filePath).toLowerCase();
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
    if (extensions.has(extension)) return category;
  }
  return 'other';
}

function inside(root, candidate, pathImpl) {
  const relative = pathImpl.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !pathImpl.isAbsolute(relative);
}

export async function previewOrganization(root, {
  fsImpl = fs,
  pathImpl = path,
  recursive = false,
  maxEntries = 1000
} = {}) {
  if (typeof root !== 'string' || root.length === 0) throw new TypeError('Organization requires a root directory');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10000) throw new RangeError('maxEntries out of range');
  const resolvedRoot = pathImpl.resolve(root);
  const moves = [];
  async function visit(directory, depth) {
    let entries;
    try {
      entries = await fsImpl.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (moves.length >= maxEntries || entry.name.startsWith('.')) continue;
      const source = pathImpl.join(directory, entry.name);
      let info;
      try {
        info = await fsImpl.lstat(source);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        if (recursive && depth < 2 && !CATEGORY_EXTENSIONS[entry.name]) await visit(source, depth + 1);
        continue;
      }
      if (!info.isFile()) continue;
      const category = categoryFor(source, pathImpl);
      const destination = pathImpl.join(resolvedRoot, category, entry.name);
      if (destination === source || !inside(resolvedRoot, destination, pathImpl)) continue;
      moves.push({ source, destination, category, sizeBytes: info.size });
    }
  }
  await visit(resolvedRoot, 0);
  return { root: resolvedRoot, moves, truncated: moves.length >= maxEntries };
}

export async function applyOrganization(plan, {
  approved = false,
  dryRun = true,
  fsImpl = fs,
  pathImpl = path
} = {}) {
  if (!plan || typeof plan.root !== 'string' || !Array.isArray(plan.moves)) throw new TypeError('Invalid organization plan');
  if (!approved && !dryRun) throw new Error('Organization requires explicit approval');
  if (dryRun) return { dryRun: true, moved: [], skipped: plan.moves.length };
  const moved = [];
  const skipped = [];
  for (const move of plan.moves) {
    if (!inside(plan.root, move.source, pathImpl) || !inside(plan.root, move.destination, pathImpl)) {
      skipped.push({ move, reason: 'outside-selected-root' });
      continue;
    }
    try {
      await fsImpl.mkdir(pathImpl.dirname(move.destination), { recursive: true });
      try {
        await fsImpl.lstat(move.destination);
        skipped.push({ move, reason: 'destination-exists' });
        continue;
      } catch {
        // Destination absence is the safe move case.
      }
      await fsImpl.rename(move.source, move.destination);
      moved.push(move);
    } catch (error) {
      skipped.push({ move, reason: error.message });
    }
  }
  return { dryRun: false, moved, skipped };
}

export async function rollbackOrganization(result, { fsImpl = fs } = {}) {
  if (!result || !Array.isArray(result.moved)) throw new TypeError('Invalid organization result');
  const restored = [];
  const skipped = [];
  for (const move of [...result.moved].reverse()) {
    try {
      await fsImpl.rename(move.destination, move.source);
      restored.push(move);
    } catch (error) {
      skipped.push({ move, reason: error.message });
    }
  }
  return { restored, skipped };
}
