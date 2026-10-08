/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Reversible quarantine authority for caller-selected files and directories.
 * It never discovers targets, follows symlinks, or silently crosses volumes.
 */

import fs from 'fs/promises';
import path from 'path';

export const QUARANTINE_VERSION = 1;
const MAX_ENTRIES = 4096;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function bytes(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function list(value) { return Array.isArray(value) ? value.filter((item) => text(item)).map((item) => text(item)) : []; }
function inside(root, candidate, pathImpl) {
  const relative = pathImpl.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !pathImpl.isAbsolute(relative);
}
function roots(value, pathImpl, required, label) {
  const resolved = [...new Set(list(value).map((item) => pathImpl.resolve(item)))];
  if (required && resolved.length === 0) throw new TypeError(`${label} requires at least one root`);
  return resolved;
}
function protectedPath(candidate, protectedRoots, pathImpl) { return protectedRoots.some((root) => candidate === root || inside(root, candidate, pathImpl)); }
function sourceAllowed(candidate, sourceRoots, pathImpl) { return sourceRoots.some((root) => inside(root, candidate, pathImpl)); }
function overlap(left, right, pathImpl) { return left === right || inside(left, right, pathImpl) || inside(right, left, pathImpl); }
function entryKind(value) { const kind = text(value)?.toLowerCase(); return kind === 'file' || kind === 'directory' ? kind : null; }
function validLimit(value) { if (!Number.isInteger(value) || value < 1 || value > MAX_ENTRIES) throw new RangeError('Quarantine maxEntries is out of range'); return value; }
function destinationFor(root, source, index, pathImpl) { return pathImpl.join(root, String(index).padStart(6, '0'), pathImpl.basename(source)); }

export function previewQuarantine(items, { sourceRoots, quarantineRoot, protectedRoots = [], maxEntries = 256, pathImpl = path } = {}) {
  if (!Array.isArray(items)) throw new TypeError('Quarantine requires explicit entries');
  const limit = validLimit(maxEntries);
  const allowedRoots = roots(sourceRoots, pathImpl, true, 'Quarantine source');
  const resolvedQuarantine = text(quarantineRoot) ? pathImpl.resolve(quarantineRoot) : null;
  if (!resolvedQuarantine) throw new TypeError('Quarantine requires a destination root');
  if (allowedRoots.some((root) => overlap(root, resolvedQuarantine, pathImpl))) throw new TypeError('Quarantine destination must be separate from source roots');
  const protectedResolved = roots(protectedRoots, pathImpl, false, 'Quarantine protected');
  const moves = [];
  const skipped = [];
  for (const [index, item] of items.slice(0, limit).entries()) {
    const source = record(item) ? text(item.path) : null;
    const resolvedSource = source ? pathImpl.resolve(source) : null;
    const kind = record(item) ? entryKind(item.kind) : null;
    const sizeBytes = record(item) ? bytes(item.sizeBytes) : null;
    if (!resolvedSource || !sourceAllowed(resolvedSource, allowedRoots, pathImpl)) { skipped.push({ item, reason: 'source-is-outside-approved-roots' }); continue; }
    if (item.protected === true || protectedPath(resolvedSource, protectedResolved, pathImpl)) { skipped.push({ item, reason: 'source-is-protected' }); continue; }
    if (!kind) { skipped.push({ item, reason: 'entry-type-is-unsupported' }); continue; }
    if (sizeBytes === null) { skipped.push({ item, reason: 'file-size-evidence-unavailable' }); continue; }
    const destination = destinationFor(resolvedQuarantine, resolvedSource, index, pathImpl);
    if (!inside(resolvedQuarantine, destination, pathImpl)) { skipped.push({ item, reason: 'destination-is-outside-quarantine-root' }); continue; }
    moves.push(Object.freeze({ source: resolvedSource, destination, kind, sizeBytes, reversible: true }));
  }
  return Object.freeze({ version: QUARANTINE_VERSION, state: moves.length ? 'preview-ready' : 'no-safe-moves', sourceRoots: Object.freeze(allowedRoots), quarantineRoot: resolvedQuarantine, protectedRoots: Object.freeze(protectedResolved), moves: Object.freeze(moves), skipped: Object.freeze(skipped), estimatedBytes: moves.reduce((sum, move) => sum + move.sizeBytes, 0), mutation: 'none', requiresApproval: true, truncated: items.length > limit });
}

function validPlan(plan, pathImpl) {
  if (!record(plan) || plan.version !== QUARANTINE_VERSION || !Array.isArray(plan.sourceRoots) || typeof plan.quarantineRoot !== 'string' || !Array.isArray(plan.moves)) throw new TypeError('Invalid quarantine plan');
  const sourceRoots = roots(plan.sourceRoots, pathImpl, true, 'Quarantine source');
  const quarantineRoot = pathImpl.resolve(plan.quarantineRoot);
  if (sourceRoots.some((root) => overlap(root, quarantineRoot, pathImpl))) throw new TypeError('Quarantine plan roots overlap');
  return { ...plan, sourceRoots, quarantineRoot };
}

export async function applyQuarantine(plan, { approved = false, dryRun = true, fsImpl = fs, pathImpl = path } = {}) {
  const checked = validPlan(plan, pathImpl);
  if (!approved && !dryRun) throw new Error('Quarantine requires explicit approval');
  if (dryRun) return Object.freeze({ version: QUARANTINE_VERSION, dryRun: true, sourceRoots: Object.freeze(checked.sourceRoots), quarantineRoot: checked.quarantineRoot, moved: Object.freeze([]), skipped: Object.freeze(checked.moves.map((move) => ({ move, reason: 'dry-run' }))), mutation: 'none' });
  const moved = [];
  const skipped = [];
  for (const move of checked.moves.slice(0, MAX_ENTRIES)) {
    const source = pathImpl.resolve(move.source);
    const destination = pathImpl.resolve(move.destination);
    if (!sourceAllowed(source, checked.sourceRoots, pathImpl) || !inside(checked.quarantineRoot, destination, pathImpl)) { skipped.push({ move, reason: 'plan-path-boundary-failed' }); continue; }
    try {
      const info = await fsImpl.lstat(source);
      if (info.isSymbolicLink()) { skipped.push({ move, reason: 'symlink' }); continue; }
      if ((move.kind === 'file' && !info.isFile()) || (move.kind === 'directory' && !info.isDirectory())) { skipped.push({ move, reason: 'source-type-changed' }); continue; }
      try { await fsImpl.lstat(destination); skipped.push({ move, reason: 'quarantine-destination-exists' }); continue; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      await fsImpl.mkdir(pathImpl.dirname(destination), { recursive: true });
      try { await fsImpl.rename(source, destination); } catch (error) { if (error?.code === 'EXDEV') { skipped.push({ move, reason: 'quarantine-must-share-volume' }); continue; } throw error; }
      moved.push(Object.freeze({ ...move, source, destination, method: 'rename' }));
    } catch (error) { skipped.push({ move, reason: error.message }); }
  }
  return Object.freeze({ version: QUARANTINE_VERSION, dryRun: false, sourceRoots: Object.freeze(checked.sourceRoots), quarantineRoot: checked.quarantineRoot, moved: Object.freeze(moved), skipped: Object.freeze(skipped), mutation: 'quarantine' });
}

export async function rollbackQuarantine(result, { fsImpl = fs, pathImpl = path } = {}) {
  if (!record(result) || result.version !== QUARANTINE_VERSION || !Array.isArray(result.sourceRoots) || typeof result.quarantineRoot !== 'string' || !Array.isArray(result.moved)) throw new TypeError('Invalid quarantine result');
  const sourceRoots = roots(result.sourceRoots, pathImpl, true, 'Quarantine source');
  const quarantineRoot = pathImpl.resolve(result.quarantineRoot);
  if (sourceRoots.some((root) => overlap(root, quarantineRoot, pathImpl))) throw new TypeError('Quarantine result roots overlap');
  const restored = [];
  const skipped = [];
  for (const move of [...result.moved].reverse()) {
    const source = pathImpl.resolve(move.source);
    const destination = pathImpl.resolve(move.destination);
    if (!sourceAllowed(source, sourceRoots, pathImpl) || !inside(quarantineRoot, destination, pathImpl)) { skipped.push({ move, reason: 'rollback-path-boundary-failed' }); continue; }
    try {
      const info = await fsImpl.lstat(destination);
      if (info.isSymbolicLink()) { skipped.push({ move, reason: 'quarantine-source-is-symlink' }); continue; }
      try { await fsImpl.lstat(source); skipped.push({ move, reason: 'restore-destination-exists' }); continue; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      await fsImpl.mkdir(pathImpl.dirname(source), { recursive: true });
      try { await fsImpl.rename(destination, source); } catch (error) { if (error?.code === 'EXDEV') { skipped.push({ move, reason: 'rollback-must-share-volume' }); continue; } throw error; }
      restored.push(Object.freeze({ ...move, method: 'rename' }));
    } catch (error) { skipped.push({ move, reason: error.message }); }
  }
  return Object.freeze({ version: QUARANTINE_VERSION, restored: Object.freeze(restored), skipped: Object.freeze(skipped), mutation: 'rollback' });
}
