/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Small persistent registry for user-selected protected paths. It stores
 * paths only, never file contents, and is consulted before cleanup planning.
 */

import fs from 'fs/promises';
import path from 'path';

export const PROTECTED_ROOTS_VERSION = 1;
const DEFAULT_MAX_ROOTS = 128;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function maxRoots(value) {
  if (!Number.isInteger(value) || value < 1 || value > 512) throw new RangeError('Protected roots maxEntries is out of range');
  return value;
}

export function normalizeProtectedRoots(values, { pathImpl = path, maxEntries = DEFAULT_MAX_ROOTS } = {}) {
  const limit = maxRoots(maxEntries);
  const rows = Array.isArray(values) ? values : [];
  const roots = [];
  for (const value of rows) {
    const candidate = text(value);
    if (!candidate) continue;
    const resolved = pathImpl.resolve(candidate);
    if (!roots.includes(resolved)) roots.push(resolved);
    if (roots.length >= limit) break;
  }
  return Object.freeze(roots);
}

export function parseProtectedRootsRecord(value, { pathImpl = path, maxEntries = DEFAULT_MAX_ROOTS } = {}) {
  const limit = maxRoots(maxEntries);
  if (!record(value) || value.version !== PROTECTED_ROOTS_VERSION || !Array.isArray(value.roots)) {
    return Object.freeze({ version: PROTECTED_ROOTS_VERSION, state: 'unavailable', roots: Object.freeze([]), reason: 'protected roots record is invalid' });
  }
  return Object.freeze({ version: PROTECTED_ROOTS_VERSION, state: 'ready', roots: normalizeProtectedRoots(value.roots, { pathImpl, maxEntries: limit }) });
}

export function createProtectedRootsStore({ filePath, fsImpl = fs, pathImpl = path, maxEntries = DEFAULT_MAX_ROOTS } = {}) {
  const target = text(filePath);
  if (!target) throw new TypeError('Protected roots store requires a file path');
  const limit = maxRoots(maxEntries);

  async function read() {
    try {
      const raw = await fsImpl.readFile(target, 'utf8');
      return parseProtectedRootsRecord(JSON.parse(String(raw)), { pathImpl, maxEntries: limit });
    } catch (error) {
      if (error?.code === 'ENOENT') return Object.freeze({ version: PROTECTED_ROOTS_VERSION, state: 'ready', roots: Object.freeze([]) });
      return Object.freeze({ version: PROTECTED_ROOTS_VERSION, state: 'unavailable', roots: Object.freeze([]), reason: error?.message || 'protected roots read failed' });
    }
  }

  async function write(roots) {
    const normalized = normalizeProtectedRoots(roots, { pathImpl, maxEntries: limit });
    await fsImpl.mkdir(pathImpl.dirname(target), { recursive: true });
    await fsImpl.writeFile(target, `${JSON.stringify({ version: PROTECTED_ROOTS_VERSION, roots: normalized }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return Object.freeze({ version: PROTECTED_ROOTS_VERSION, state: 'ready', roots: normalized });
  }

  async function update(operation, values) {
    const current = await read();
    if (current.state !== 'ready') throw new Error(current.reason);
    const requested = normalizeProtectedRoots(values, { pathImpl, maxEntries: limit });
    if (operation === 'add' && requested.length === 0) throw new TypeError('Protected roots add requires at least one path');
    const next = operation === 'add'
      ? normalizeProtectedRoots([...current.roots, ...requested], { pathImpl, maxEntries: limit })
      : normalizeProtectedRoots(current.roots.filter((root) => !requested.includes(root)), { pathImpl, maxEntries: limit });
    return write(next);
  }

  return Object.freeze({
    version: PROTECTED_ROOTS_VERSION,
    read,
    add: (values) => update('add', values),
    remove: (values) => update('remove', values)
  });
}
