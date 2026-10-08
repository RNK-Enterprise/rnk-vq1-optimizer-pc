/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded cross-platform file evidence for the organizer. It identifies
 * review candidates without moving, deleting, or classifying uncertainty as
 * permission to act.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const FILE_INSIGHTS_VERSION = 1;
const INCOMPLETE = /\.(?:part|crdownload|download|partial|tmp)$/i;
const INSTALLERS = new Set(['.appx', '.dmg', '.exe', '.msi', '.msix', '.pkg']);
const ARCHIVES = new Set(['.7z', '.gz', '.iso', '.rar', '.tar', '.zip']);
const MODELS = new Set(['.bin', '.ckpt', '.gguf', '.onnx', '.safetensors']);

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function bytes(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function records(value) { return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []; }
function category(filePath, pathImpl) {
  const extension = pathImpl.extname(filePath).toLowerCase();
  if (INCOMPLETE.test(pathImpl.basename(filePath))) return 'incomplete-download';
  if (INSTALLERS.has(extension)) return 'installer';
  if (ARCHIVES.has(extension)) return extension === '.iso' ? 'iso' : 'archive';
  if (MODELS.has(extension)) return 'model';
  return 'other';
}
function insideOrSame(root, candidate, pathImpl) {
  const relative = pathImpl.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !pathImpl.isAbsolute(relative));
}
function protectedFile(filePath, roots, pathImpl) { return roots.some((root) => insideOrSame(root, filePath, pathImpl)); }
function validNow(now) { if (typeof now !== 'function') throw new TypeError('File insights clock must be callable'); const value = now(); if (!Number.isFinite(value)) throw new TypeError('File insights clock must return a number'); return value; }

async function defaultHashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    for (;;) {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally { await handle.close(); }
  return hash.digest('hex');
}

export function buildFileInsightPlan(scan, { targetRoot = null, pathImpl = path } = {}) {
  if (!scan || typeof scan !== 'object' || !Array.isArray(scan.entries)) throw new TypeError('File insight scan is required');
  const target = text(targetRoot) ? pathImpl.resolve(targetRoot) : null;
  const entries = records(scan.entries);
  const review = entries.filter((item) => item.protected !== true).map((item) => Object.freeze({ path: item.path, category: item.category, operation: 'review', reason: item.category === 'incomplete-download' ? 'incomplete-download' : item.category === 'installer' && item.ageHours >= scan.policy.minAgeHours ? 'stale-installer' : item.sizeBytes >= scan.policy.largeFileBytes ? 'large-file' : 'catalogue-only', destination: target && item.category !== 'other' ? pathImpl.join(target, item.category, pathImpl.basename(item.path)) : null, requiresApproval: true, mutation: 'none' }));
  const duplicateGroups = records(scan.duplicates).map((group) => Object.freeze({ ...group, operation: 'review-duplicate-group', requiresApproval: true, mutation: 'none' }));
  return Object.freeze({ version: FILE_INSIGHTS_VERSION, root: scan.root, targetRoot: target, review: Object.freeze(review), duplicates: Object.freeze(duplicateGroups), requiresApproval: true, mutation: 'none', reason: 'read-only evidence; use the organizer preview before any move' });
}

export async function scanFileInsights(root, {
  fsImpl = fs,
  pathImpl = path,
  maxEntries = 2000,
  maxDepth = 4,
  minAgeHours = 24 * 30,
  largeFileBytes = 1024 ** 3,
  protectedRoots = [],
  hashFiles = false,
  maxHashBytes = 256 * 1024 ** 2,
  hashFileImpl = defaultHashFile,
  now = Date.now
} = {}) {
  const requestedRoot = text(root);
  if (!requestedRoot) throw new TypeError('File insights requires an explicit root');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10000) throw new RangeError('File insights maxEntries is out of range');
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 12) throw new RangeError('File insights maxDepth is out of range');
  if (!Number.isFinite(minAgeHours) || minAgeHours < 0 || !Number.isFinite(largeFileBytes) || largeFileBytes < 0 || !Number.isFinite(maxHashBytes) || maxHashBytes < 0) throw new RangeError('File insights policy is invalid');
  const timestamp = validNow(now);
  const resolvedRoot = pathImpl.resolve(requestedRoot);
  const protectedPaths = records(protectedRoots).map((item) => text(item)).filter(Boolean).concat(Array.isArray(protectedRoots) ? protectedRoots.filter((item) => typeof item === 'string') : []).map((item) => pathImpl.resolve(item));
  const state = { entries: [], unreadableRoots: 0, symlinkCount: 0, raceCount: 0 };
  async function visit(directory, depth) {
    if (depth > maxDepth || state.entries.length >= maxEntries) return;
    let entries;
    try { entries = await fsImpl.readdir(directory, { withFileTypes: true }); } catch { state.unreadableRoots += 1; return; }
    for (const entry of entries) {
      if (state.entries.length >= maxEntries) break;
      const candidate = pathImpl.join(directory, entry.name);
      if (entry.isSymbolicLink?.()) { state.symlinkCount += 1; continue; }
      if (entry.isDirectory?.()) { if (entry.name !== '.git') await visit(candidate, depth + 1); continue; }
      if (!entry.isFile?.()) continue;
      let info;
      try { info = await fsImpl.stat(candidate); } catch { state.raceCount += 1; continue; }
      const sizeBytes = bytes(info.size) || 0;
      const ageHours = Number.isFinite(info.mtimeMs) ? Math.max(0, (timestamp - info.mtimeMs) / 3600000) : null;
      let sha256 = null;
      let hashState = 'not-requested';
      if (hashFiles && sizeBytes <= maxHashBytes) {
        try { const hash = String(await hashFileImpl(candidate)).toLowerCase(); sha256 = /^[a-f0-9]{64}$/.test(hash) ? hash : null; hashState = sha256 ? 'verified-locally' : 'invalid-hash'; } catch { hashState = 'unavailable'; }
      } else if (hashFiles) hashState = 'too-large-to-hash';
      state.entries.push(Object.freeze({ path: candidate, name: entry.name, category: category(candidate, pathImpl), sizeBytes, ageHours, modifiedAt: Number.isFinite(info.mtimeMs) ? new Date(info.mtimeMs).toISOString() : null, protected: protectedFile(candidate, protectedPaths, pathImpl), sha256, hashState }));
    }
  }
  await visit(resolvedRoot, 0);
  const groups = new Map();
  state.entries.forEach((entry) => { if (entry.sha256) groups.set(entry.sha256, [...(groups.get(entry.sha256) || []), entry.path]); });
  const duplicates = [...groups.entries()].filter(([, paths]) => paths.length > 1).map(([sha256, paths]) => Object.freeze({ sha256, paths: Object.freeze(paths) }));
  return Object.freeze({ version: FILE_INSIGHTS_VERSION, root: resolvedRoot, policy: Object.freeze({ minAgeHours, largeFileBytes }), entryCount: state.entries.length, truncated: state.entries.length >= maxEntries, entries: Object.freeze(state.entries), duplicates: Object.freeze(duplicates), incomplete: Object.freeze(state.entries.filter((item) => item.category === 'incomplete-download')), staleInstallers: Object.freeze(state.entries.filter((item) => item.category === 'installer' && item.ageHours !== null && item.ageHours >= minAgeHours)), largeFiles: Object.freeze(state.entries.filter((item) => item.sizeBytes >= largeFileBytes)), protectedCount: state.entries.filter((item) => item.protected).length, symlinkCount: state.symlinkCount, raceCount: state.raceCount, unreadableRoots: state.unreadableRoots, mutation: 'none' });
}
