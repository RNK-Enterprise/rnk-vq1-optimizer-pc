/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Explicit cross-volume file placement. The caller supplies the files and
 * roots; this module never discovers or moves arbitrary large directories.
 */

import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { assessStorageTarget, storageSuitabilityForPath } from './storage-suitability.js';

export const FILE_PLACEMENT_VERSION = 2;
const MAX_ENTRIES = 10000;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function bytes(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function list(value) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : []; }
function inside(root, candidate, pathImpl) { const relative = pathImpl.relative(root, candidate); return relative !== '' && !relative.startsWith('..') && !pathImpl.isAbsolute(relative); }
function rootList(value, pathImpl, message, required = false) { const roots = list(value).map((item) => pathImpl.resolve(item)); if (required && roots.length === 0) throw new TypeError(`${message} requires at least one root`); return roots; }
function protectedPath(candidate, roots, pathImpl) { return roots.some((root) => inside(root, candidate, pathImpl)); }
function sourceAllowed(candidate, roots, pathImpl) { return roots.some((root) => inside(root, candidate, pathImpl)); }
function category(value) { return text(value)?.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'other'; }
function targetSuitability(storageEvidence, targetRoot, pathImpl) {
  if (record(storageEvidence) && ['HEALTHY', 'DEGRADED', 'FAILED', 'UNKNOWN'].includes(storageEvidence.state)) return storageEvidence;
  if (!record(storageEvidence)) return assessStorageTarget({ targetMount: null });
  return storageSuitabilityForPath(targetRoot, {
    pathImpl,
    volumes: storageEvidence.volumes || [],
    drives: storageEvidence.drives || [],
    hardFailureEvidence: storageEvidence.hardFailureEvidence || []
  });
}

export function previewFilePlacement({ files, sourceRoots, targetRoot, protectedRoots = [], targetFreeBytes, storageEvidence = null, maxEntries = 256, preserveSource = false, pathImpl = path } = {}) {
  if (!Array.isArray(files)) throw new TypeError('File placement requires file facts');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES) throw new RangeError('File placement maxEntries is out of range');
  const allowedRoots = rootList(sourceRoots, pathImpl, 'File placement source', true);
  const resolvedTarget = text(targetRoot) ? pathImpl.resolve(targetRoot) : null;
  if (!resolvedTarget) throw new TypeError('File placement requires a target root');
  const protectedResolved = rootList(protectedRoots, pathImpl, 'File placement protected');
  const free = bytes(targetFreeBytes);
  const suitability = targetSuitability(storageEvidence, resolvedTarget, pathImpl);
  if (suitability.admission !== 'ALLOW') return Object.freeze({ version: FILE_PLACEMENT_VERSION, state: 'storage-target-rejected', targetRoot: resolvedTarget, sourceRoots: Object.freeze(allowedRoots), storageSuitability: suitability, moves: Object.freeze([]), skipped: Object.freeze([{ reason: suitability.reasons?.[0] || 'storage-suitability-required' }]), estimatedBytes: 0, remainingFreeBytes: free, mutation: 'none' });
  if (free === null) return Object.freeze({ version: FILE_PLACEMENT_VERSION, state: 'observation-required', targetRoot: resolvedTarget, sourceRoots: Object.freeze(allowedRoots), storageSuitability: suitability, moves: Object.freeze([]), skipped: Object.freeze([{ reason: 'target free-space evidence is unavailable' }]), estimatedBytes: 0, remainingFreeBytes: null, mutation: 'none' });
  let remaining = free;
  const moves = [];
  const skipped = [];
  for (const file of files.slice(0, MAX_ENTRIES)) {
    if (moves.length >= maxEntries) break;
    const source = record(file) && text(file.path) ? pathImpl.resolve(file.path) : null;
    const sizeBytes = record(file) ? bytes(file.sizeBytes) : null;
    if (!source || !sourceAllowed(source, allowedRoots, pathImpl)) { skipped.push({ file, reason: 'source-is-outside-approved-roots' }); continue; }
    if (protectedPath(source, protectedResolved, pathImpl) || file.protected === true) { skipped.push({ file, reason: 'source-is-protected' }); continue; }
    if (sizeBytes === null) { skipped.push({ file, reason: 'file-size-evidence-unavailable' }); continue; }
    const destination = pathImpl.join(resolvedTarget, category(file.category), pathImpl.basename(source));
    if (!inside(resolvedTarget, destination, pathImpl)) { skipped.push({ file, reason: 'destination-is-outside-target-root' }); continue; }
    if (destination === source) { skipped.push({ file, reason: 'source-already-at-destination' }); continue; }
    if (sizeBytes > remaining) { skipped.push({ file, reason: 'target-volume-lacks-space' }); continue; }
    moves.push(Object.freeze({ source, destination, sizeBytes, category: category(file.category), preserveSource: preserveSource === true, reversible: true }));
    remaining -= sizeBytes;
  }
  return Object.freeze({ version: FILE_PLACEMENT_VERSION, state: moves.length ? 'preview-ready' : 'no-safe-moves', targetRoot: resolvedTarget, sourceRoots: Object.freeze(allowedRoots), protectedRoots: Object.freeze(protectedResolved), storageSuitability: suitability, preserveSource: preserveSource === true, moves: Object.freeze(moves), skipped: Object.freeze(skipped), estimatedBytes: free - remaining, remainingFreeBytes: remaining, mutation: 'none' });
}

function validPlan(plan, pathImpl) {
  if (!record(plan) || plan.version !== FILE_PLACEMENT_VERSION || typeof plan.targetRoot !== 'string' || !Array.isArray(plan.sourceRoots) || !Array.isArray(plan.moves) || plan.storageSuitability?.admission !== 'ALLOW') throw new TypeError('Invalid file placement plan');
  return plan;
}

async function hashFile(file, fsImpl) {
  if (typeof fsImpl.open === 'function') {
    const handle = await fsImpl.open(file, 'r');
    try {
      if (typeof handle.read !== 'function') throw new Error('copy hash verification unavailable');
      const hash = createHash('sha256');
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      while (true) {
        const result = await handle.read(buffer, 0, buffer.length, null);
        if (!result?.bytesRead) break;
        hash.update(buffer.subarray(0, result.bytesRead));
      }
      return hash.digest('hex');
    } finally { if (typeof handle.close === 'function') await handle.close(); }
  }
  if (typeof fsImpl.readFile === 'function') return createHash('sha256').update(await fsImpl.readFile(file)).digest('hex');
  throw new Error('copy hash verification unavailable');
}

async function flushFile(file, fsImpl) {
  if (typeof fsImpl.open !== 'function') return;
  const handle = await fsImpl.open(file, 'r+');
  try { if (typeof handle.sync === 'function') await handle.sync(); }
  finally { if (typeof handle.close === 'function') await handle.close(); }
}

async function removePartialDestination(destination, fsImpl) {
  try {
    const info = await fsImpl.lstat(destination);
    if (info.isSymbolicLink?.() || info.isDirectory?.()) throw new Error('partial destination is not a regular file');
    await fsImpl.unlink(destination);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function transfer(source, destination, move, fsImpl, preserveSource = false) {
  const partial = `${destination}.rnk-partial`;
  let destinationCreated = false;
  try {
    destinationCreated = true;
    const copyFlags = fsImpl.constants?.COPYFILE_EXCL ?? 1;
    await fsImpl.copyFile(source, partial, copyFlags);
    await flushFile(partial, fsImpl);
    const info = await fsImpl.stat(partial);
    const sourceSha256 = await hashFile(source, fsImpl);
    const destinationSha256 = await hashFile(partial, fsImpl);
    if (bytes(info.size) !== move.sizeBytes || sourceSha256 !== destinationSha256) throw new Error('copy verification failed');
    await fsImpl.rename(partial, destination);
    if (!preserveSource) await fsImpl.unlink(source);
    return { method: 'copy-delete', bytes: info.size, sourceHash: sourceSha256, destinationHash: destinationSha256, verificationState: 'verified', sourceDeletionState: preserveSource ? 'preserved' : 'deleted' };
  } catch (error) {
    if (destinationCreated && error?.code !== 'EEXIST') {
      try { await fsImpl.unlink(partial); } catch (cleanupError) { if (cleanupError?.code !== 'ENOENT') error.cleanupError = cleanupError.message; }
    }
    throw error;
  }
}

export async function applyFilePlacement(plan, { approved = false, dryRun = true, fsImpl = fs, pathImpl = path } = {}) {
  validPlan(plan, pathImpl);
  if (!approved && !dryRun) throw new Error('File placement requires explicit approval');
  if (dryRun) return Object.freeze({ dryRun: true, moved: Object.freeze([]), skipped: plan.moves.map((move) => ({ move, reason: 'dry-run' })) });
  const moved = [];
  const skipped = [];
  for (const move of plan.moves.slice(0, MAX_ENTRIES)) {
    if (!sourceAllowed(pathImpl.resolve(move.source), plan.sourceRoots.map((root) => pathImpl.resolve(root)), pathImpl) || !inside(pathImpl.resolve(plan.targetRoot), pathImpl.resolve(move.destination), pathImpl) || protectedPath(pathImpl.resolve(move.source), (plan.protectedRoots || []).map((root) => pathImpl.resolve(root)), pathImpl)) { skipped.push({ move, reason: 'plan-path-boundary-failed' }); continue; }
    try {
      await fsImpl.mkdir(pathImpl.dirname(move.destination), { recursive: true });
      await removePartialDestination(`${move.destination}.rnk-partial`, fsImpl);
      try { await fsImpl.lstat(move.destination); skipped.push({ move, reason: 'destination-exists' }); continue; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      const verification = await transfer(move.source, move.destination, move, fsImpl, move.preserveSource === true || plan.preserveSource === true);
      moved.push({ ...move, ...verification });
    } catch (error) { skipped.push({ move, reason: error.message }); }
  }
  return Object.freeze({ dryRun: false, moved: Object.freeze(moved), skipped: Object.freeze(skipped) });
}

export async function rollbackFilePlacement(result, { fsImpl = fs, pathImpl = path } = {}) {
  if (!record(result) || !Array.isArray(result.moved)) throw new TypeError('Invalid file placement result');
  const restored = [];
  const skipped = [];
  for (const move of [...result.moved].reverse()) {
    try {
      if (move.preserveSource === true || move.sourceDeletionState === 'preserved') {
        await fsImpl.unlink(move.destination);
        restored.push({ ...move, method: 'delete-copy', sourceDeletionState: 'preserved' });
      } else {
        const verification = await transfer(move.destination, move.source, move, fsImpl);
        restored.push({ ...move, ...verification });
      }
    } catch (error) { skipped.push({ move, reason: error.message }); }
  }
  return Object.freeze({ restored: Object.freeze(restored), skipped: Object.freeze(skipped) });
}
