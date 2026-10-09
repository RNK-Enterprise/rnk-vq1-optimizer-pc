/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded download planning and verification. This module observes explicit
 * download roots and volume facts; it never starts, moves, or deletes a file.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { assessStorageSuitability } from './storage-suitability.js';

export const DOWNLOAD_GUARD_VERSION = 2;
const INCOMPLETE = /\.(?:part|crdownload|download|partial|tmp)$/i;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function bytes(value) { const parsed = typeof value === 'string' && value.trim() ? Number(value) : value; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function requireRoot(root) { const value = text(root); if (!value) throw new TypeError('Download guard requires an explicit root'); return value; }
function requireHash(hash) { const value = text(hash)?.toLowerCase(); if (!/^[a-f0-9]{64}$/.test(value || '')) throw new TypeError('Download guard requires a SHA-256 hash'); return value; }
function boundedRows(value, limit) { return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object').slice(0, limit) : []; }

export function preflightDownload({ sizeBytes, destinationMount = null, volumes = [], drives = [], hardFailureEvidence = [] } = {}) {
  const size = bytes(sizeBytes);
  const rows = boundedRows(volumes, 64).map((volume) => ({ ...volume, mount: text(volume.mount), freeBytes: bytes(volume.freeBytes), writable: volume.writable !== false, system: volume.system === true, suitability: assessStorageSuitability({ volume, drives, hardFailureEvidence }) }));
  if (size === null) return Object.freeze({ state: 'observation-required', sizeBytes: null, requestedMount: text(destinationMount), targetMount: null, reason: 'download size is unavailable' });
  const requested = text(destinationMount)?.toLowerCase() || null;
  const requestedRow = rows.find((row) => row.mount?.toLowerCase() === requested);
  const safeRows = rows.filter((row) => row.suitability.admission === 'ALLOW' && row.writable && row.freeBytes !== null);
  const available = safeRows.filter((row) => row.freeBytes >= size).sort((left, right) => right.freeBytes - left.freeBytes);
  const target = requestedRow?.suitability.admission === 'ALLOW' && requestedRow.freeBytes >= size ? requestedRow : available[0] || null;
  const enough = Boolean(target && target.freeBytes !== null && target.freeBytes >= size);
  const state = enough ? target.mount?.toLowerCase() === requested ? 'allow' : 'redirect' : rows.length && safeRows.length === 0 ? 'storage-safety-review' : 'insufficient-space';
  return Object.freeze({ state, sizeBytes: size, requestedMount: text(destinationMount), targetMount: target?.mount || null, freeBytesAtTarget: target?.freeBytes ?? null, targetSuitability: target?.suitability || null, rejectedMounts: Object.freeze(rows.filter((row) => row.suitability.admission !== 'ALLOW').map((row) => Object.freeze({ mount: row.mount, state: row.suitability.state, reasons: row.suitability.reasons }))), reason: state === 'allow' ? 'requested-destination-has-headroom' : state === 'redirect' ? 'requested-destination-lacks-headroom' : state === 'storage-safety-review' ? 'no-volume-passed-physical-storage-suitability' : 'no-volume-can-fit-download' });
}

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
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

async function walk(root, options, state, depth = 0) {
  if (depth > options.maxDepth || state.entries.length >= options.maxEntries) return;
  let entries;
  try { entries = await options.fsImpl.readdir(root, { withFileTypes: true }); } catch { state.unreadableRoots += 1; return; }
  for (const entry of entries) {
    if (state.entries.length >= options.maxEntries) break;
    const candidate = options.pathImpl.join(root, entry.name);
    if (entry.isSymbolicLink?.()) { state.symlinkCount += 1; continue; }
    if (entry.isDirectory?.()) { await walk(candidate, options, state, depth + 1); continue; }
    if (!entry.isFile?.()) continue;
    let info;
    try { info = await options.fsImpl.stat(candidate); } catch { state.raceCount += 1; continue; }
    const incomplete = INCOMPLETE.test(entry.name);
    let sha256 = null;
    let hashState = 'not-requested';
    if (options.hashFiles && info.size <= options.maxHashBytes) {
      try { sha256 = (await options.hashFileImpl(candidate)).toLowerCase(); hashState = /^[a-f0-9]{64}$/.test(sha256) ? 'verified-locally' : 'invalid-hash'; } catch { hashState = 'unavailable'; }
    } else if (options.hashFiles) hashState = 'too-large-to-hash';
    state.entries.push(Object.freeze({ path: candidate, name: entry.name, sizeBytes: bytes(info.size) || 0, modifiedAt: Number.isFinite(info.mtimeMs) ? new Date(info.mtimeMs).toISOString() : null, incomplete, sha256, hashState }));
  }
}

export async function scanDownloadRoot(root, { fsImpl = fs, pathImpl = path, maxEntries = 512, maxDepth = 3, hashFiles = false, maxHashBytes = 256 * 1024 ** 2, hashFileImpl = defaultHashFile } = {}) {
  const resolvedRoot = requireRoot(root);
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10000) throw new RangeError('Download guard maxEntries is out of range');
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 8) throw new RangeError('Download guard maxDepth is out of range');
  if (!Number.isFinite(maxHashBytes) || maxHashBytes < 0) throw new RangeError('Download guard maxHashBytes is invalid');
  const state = { entries: [], symlinkCount: 0, raceCount: 0, unreadableRoots: 0 };
  await walk(resolvedRoot, { fsImpl, pathImpl, maxEntries, maxDepth, hashFiles: hashFiles === true, maxHashBytes, hashFileImpl }, state);
  const groups = new Map();
  state.entries.forEach((entry) => { if (entry.sha256) groups.set(entry.sha256, [...(groups.get(entry.sha256) || []), entry.path]); });
  const duplicates = [...groups.entries()].filter(([, paths]) => paths.length > 1).map(([sha256, paths]) => Object.freeze({ sha256, paths: Object.freeze(paths) }));
  return Object.freeze({ version: DOWNLOAD_GUARD_VERSION, root: resolvedRoot, entryCount: state.entries.length, truncated: state.entries.length >= maxEntries, incomplete: Object.freeze(state.entries.filter((entry) => entry.incomplete)), entries: Object.freeze(state.entries), duplicates: Object.freeze(duplicates), symlinkCount: state.symlinkCount, raceCount: state.raceCount, unreadableRoots: state.unreadableRoots, mutation: 'none' });
}

export async function verifyDownloadHash(filePath, expectedHash, { hashFileImpl = defaultHashFile } = {}) {
  const target = requireRoot(filePath);
  const expected = requireHash(expectedHash);
  let actual;
  try { actual = String(await hashFileImpl(target)).toLowerCase(); } catch (error) { return Object.freeze({ state: 'unavailable', path: target, expectedHash: expected, actualHash: null, reason: error.message }); }
  return Object.freeze({ state: actual === expected ? 'verified' : 'mismatch', path: target, expectedHash: expected, actualHash: actual, reason: actual === expected ? 'sha256-matches' : 'sha256-does-not-match' });
}

export function createDownloadGuard(options = {}) {
  return Object.freeze({
    version: DOWNLOAD_GUARD_VERSION,
    preflight: (input = {}) => preflightDownload({ ...input, ...options }),
    scan: (root, scanOptions = {}) => scanDownloadRoot(root, { ...options, ...scanOptions }),
    verify: (filePath, expectedHash, verifyOptions = {}) => verifyDownloadHash(filePath, expectedHash, { ...options, ...verifyOptions })
  });
}
