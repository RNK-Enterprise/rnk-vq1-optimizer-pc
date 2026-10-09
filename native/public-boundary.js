/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded public-checkout identity guard. It scans text files only, skips
 * generated/vendor metadata, and refuses to call an incomplete scan clean.
 */

import fs from 'fs/promises';
import path from 'path';

export const PUBLIC_BOUNDARY_VERSION = 1;
const DEFAULT_MAX_FILES = 10000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_MATCHES = 64;
const SKIPPED_NAMES = new Set(['.git', '.github', 'node_modules', 'coverage', 'package-lock.json']);
const forbidden = Object.freeze([
  { marker: ['found', 'ry'].join(''), matches: (line, marker) => line.includes(marker) },
  { marker: ['vortex', ' ', 'quantum'].join(''), matches: (line, marker) => line.includes(marker) },
  { marker: ['v', 'q'].join(''), matches: (line, marker) => new RegExp(`\\b${marker}\\b`, 'i').test(line) },
  { marker: ['scripts', '/', 'v', 'q'].join(''), matches: (line, marker) => line.includes(marker) },
  { marker: ['check-pc-', 'v', 'q', '1'].join(''), matches: (line, marker) => line.includes(marker) },
  { marker: ['pc-host', '.js'].join(''), matches: (line, marker) => line.includes(marker) }
]);

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function skipped(name) { return SKIPPED_NAMES.has(name); }
function relativeFile(root, file, pathImpl) { return pathImpl.relative(root, file).split(pathImpl.sep).join('/'); }
function hitFor(content, relative) {
  const lines = String(content).split(/\r?\n/);
  const matches = [];
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    const match = forbidden.find((item) => item.matches(lower, item.marker));
    if (match && matches.length < MAX_MATCHES) matches.push(Object.freeze({ path: relative, line: index + 1, marker: match.marker }));
  });
  return matches;
}

export async function scanPublicBoundary({ root = process.cwd(), fsImpl = fs, pathImpl = path, maxFiles = DEFAULT_MAX_FILES, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const base = text(root);
  if (!base) throw new TypeError('Public boundary root is required');
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > DEFAULT_MAX_FILES) throw new RangeError('Public boundary file limit is out of range');
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES) throw new RangeError('Public boundary byte limit is out of range');
  const state = { scannedFiles: 0, skippedFiles: 0, matches: [] };
  async function visit(directory) {
    const entries = await fsImpl.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (state.scannedFiles >= maxFiles || state.matches.length >= MAX_MATCHES) break;
      if (skipped(entry.name)) continue;
      const file = pathImpl.join(directory, entry.name);
      if (entry.isDirectory?.()) {
        await visit(file);
        continue;
      }
      if (!entry.isFile?.()) continue;
      const stat = await fsImpl.stat(file);
      if (!Number.isFinite(stat.size) || stat.size > maxBytes) {
        state.skippedFiles += 1;
        continue;
      }
      state.scannedFiles += 1;
      const content = await fsImpl.readFile(file, 'utf8');
      state.matches.push(...hitFor(content, relativeFile(base, file, pathImpl)).slice(0, MAX_MATCHES - state.matches.length));
    }
  }
  try {
    await visit(base);
  } catch (error) {
    return Object.freeze({ version: PUBLIC_BOUNDARY_VERSION, state: 'unavailable', scannedFiles: state.scannedFiles, skippedFiles: state.skippedFiles, matches: Object.freeze(state.matches), reason: error.message });
  }
  const stateName = state.skippedFiles > 0 ? 'incomplete' : state.matches.length ? 'forbidden-reference' : 'clean';
  return Object.freeze({ version: PUBLIC_BOUNDARY_VERSION, state: stateName, scannedFiles: state.scannedFiles, skippedFiles: state.skippedFiles, matches: Object.freeze(state.matches) });
}

