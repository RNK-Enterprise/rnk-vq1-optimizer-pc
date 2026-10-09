/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Explicit cross-volume browser download relocation. The native host owns
 * source/target roots; browser messages can select only a pending download.
 */

import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { assessStorageTarget } from './storage-suitability.js';

export const BROWSER_REDIRECT_VERSION = 2;
const MAX_SIZE = 1024 ** 4;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function bytes(value) { return Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= MAX_SIZE ? value : null; }
function inside(root, candidate, pathImpl) { const relative = pathImpl.relative(root, candidate); return relative !== '' && !relative.startsWith('..') && !pathImpl.isAbsolute(relative); }
function mountOf(candidate, pathImpl) { const windows = /^[A-Za-z]:/u.exec(candidate); return windows ? `${windows[0][0].toUpperCase()}:` : text(pathImpl.parse(candidate).root); }
function invalid(reason) { return Object.freeze({ version: BROWSER_REDIRECT_VERSION, state: 'rejected', mutation: 'none', reason }); }

async function hashFile(file, fsImpl) {
  if (typeof fsImpl.open === 'function') {
    const handle = await fsImpl.open(file, 'r');
    try {
      if (typeof handle.read !== 'function') throw new Error('redirect hash verification unavailable');
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
  throw new Error('redirect hash verification unavailable');
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
    if (info.isSymbolicLink?.() || info.isDirectory?.()) throw new Error('partial redirect destination is not a regular file');
    await fsImpl.unlink(destination);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function targetSuitability(target, storageEvidence) {
  if (record(storageEvidence) && ['HEALTHY', 'DEGRADED', 'FAILED', 'UNKNOWN'].includes(storageEvidence.state)) return storageEvidence;
  if (!record(storageEvidence)) return assessStorageTarget({ targetMount: target });
  return assessStorageTarget({
    targetMount: target,
    volumes: storageEvidence.volumes || [],
    drives: storageEvidence.drives || [],
    hardFailureEvidence: storageEvidence.hardFailureEvidence || []
  });
}

export function previewBrowserRedirect({ sourcePath, sourceRoot, targetRoot, targetMount, sizeBytes, targetFreeBytes, storageEvidence = null, preserveSource = false, pathImpl = path } = {}) {
  const source = text(sourcePath) ? pathImpl.resolve(sourcePath) : null;
  const sourceBase = text(sourceRoot) ? pathImpl.resolve(sourceRoot) : null;
  const targetBase = text(targetRoot) ? pathImpl.resolve(targetRoot) : null;
  const target = text(targetMount)?.toUpperCase() || null;
  const size = bytes(sizeBytes);
  const free = bytes(targetFreeBytes);
  if (!source || !sourceBase || !targetBase || !target) return invalid('source, source root, target root, and target mount are required');
  if (!inside(sourceBase, source, pathImpl)) return invalid('browser download is outside the approved source root');
  if (size === null || free === null) return Object.freeze({ version: BROWSER_REDIRECT_VERSION, state: 'observation-required', mutation: 'none', reason: 'download size or target free-space evidence is unavailable' });
  const sourceMount = mountOf(source, pathImpl);
  if (!sourceMount || sourceMount === target) return invalid(sourceMount === target ? 'source and target are on the same volume' : 'source volume is unavailable');
  if (free < size) return invalid('target volume lacks space for the download');
  const suitability = targetSuitability(target, storageEvidence);
  if (suitability.admission !== 'ALLOW') return Object.freeze({ version: BROWSER_REDIRECT_VERSION, state: 'storage-safety-review', mutation: 'none', targetMount: target, storageSuitability: suitability, reason: suitability.reasons?.[0] || 'target storage suitability is not proven' });
  const destination = pathImpl.join(targetBase, pathImpl.basename(source));
  if (!inside(targetBase, destination, pathImpl)) return invalid('redirect destination is outside the approved target root');
  return Object.freeze({ version: BROWSER_REDIRECT_VERSION, state: 'preview-ready', mutation: 'none', source, sourceRoot: sourceBase, sourceMount, targetRoot: targetBase, targetMount: target, destination, sizeBytes: size, targetFreeBytes: free, storageSuitability: suitability, preserveSource: preserveSource === true, reversible: true });
}

export async function applyBrowserRedirect(plan, { approved = false, dryRun = true, fsImpl = fs, pathImpl = path } = {}) {
  if (!record(plan) || plan.version !== BROWSER_REDIRECT_VERSION || plan.state !== 'preview-ready' || plan.storageSuitability?.admission !== 'ALLOW') throw new TypeError('Invalid browser redirect plan');
  if (!approved) return Object.freeze({ state: 'approval-required', applied: false, mutation: 'none', plan });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, mutation: 'none', plan });
  if (!fsImpl || typeof fsImpl.lstat !== 'function' || typeof fsImpl.mkdir !== 'function' || typeof fsImpl.copyFile !== 'function' || typeof fsImpl.stat !== 'function' || typeof fsImpl.rename !== 'function' || typeof fsImpl.unlink !== 'function') return Object.freeze({ state: 'unavailable', applied: false, mutation: 'none', reason: 'file relocation dependencies are unavailable' });
  try {
    const sourceInfo = await fsImpl.lstat(plan.source);
    if (sourceInfo.isSymbolicLink?.()) return Object.freeze({ state: 'rejected', applied: false, mutation: 'none', reason: 'source download is a symbolic link' });
    await removePartialDestination(`${plan.destination}.rnk-partial`, fsImpl);
    try { await fsImpl.lstat(plan.destination); return Object.freeze({ state: 'rejected', applied: false, mutation: 'none', reason: 'redirect destination already exists' }); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await fsImpl.mkdir(pathImpl.dirname(plan.destination), { recursive: true });
    let destinationCreated = false;
    const partial = `${plan.destination}.rnk-partial`;
    try {
      destinationCreated = true;
      const copyFlags = fsImpl.constants?.COPYFILE_EXCL ?? 1;
      await fsImpl.copyFile(plan.source, partial, copyFlags);
      await flushFile(partial, fsImpl);
      const destinationInfo = await fsImpl.stat(partial);
      const sourceSha256 = await hashFile(plan.source, fsImpl);
      const destinationSha256 = await hashFile(partial, fsImpl);
      if (destinationInfo.size !== plan.sizeBytes || sourceSha256 !== destinationSha256) throw new Error('redirect copy verification failed');
      await fsImpl.rename(partial, plan.destination);
      if (plan.preserveSource !== true) await fsImpl.unlink(plan.source);
      return Object.freeze({ state: 'applied', applied: true, mutation: 'copy-delete', source: plan.source, destination: plan.destination, bytes: destinationInfo.size, sourceHash: sourceSha256, destinationHash: destinationSha256, verificationState: 'verified', sourceDeletionState: plan.preserveSource === true ? 'preserved' : 'deleted' });
    } catch (error) {
      if (destinationCreated && error?.code !== 'EEXIST') {
        try { await fsImpl.unlink(partial); } catch (cleanupError) { if (cleanupError?.code !== 'ENOENT') error.cleanupError = cleanupError.message; }
      }
      throw error;
    }
  } catch (error) { return Object.freeze({ state: 'rejected', applied: false, mutation: 'none', reason: error.message }); }
}
