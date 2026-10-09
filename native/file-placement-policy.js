/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded category-to-volume placement policy. It consumes a prior file
 * insight scan and delegates all mutation to the explicit placement authority.
 */

import path from 'path';
import { applyFilePlacement, previewFilePlacement, rollbackFilePlacement } from './file-placement.js';
import { isPathInside } from './storage-targets.js';
import { assessStorageSuitability } from './storage-suitability.js';

export const FILE_PLACEMENT_POLICY_VERSION = 1;
const SKIP_CATEGORIES = new Set(['incomplete-download']);
const DEFAULT_MEDIA_PREFERENCES = Object.freeze({ model: 'hdd', archive: 'hdd', iso: 'hdd', installer: 'hdd' });

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function bytes(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function category(value) { return text(value)?.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'other'; }
function targetMap(value, pathImpl) {
  if (!record(value)) throw new TypeError('Placement policy requires category target roots');
  const entries = Object.entries(value).map(([key, root]) => [category(key), text(root) ? pathImpl.resolve(root) : null]).filter(([, root]) => root);
  if (!entries.length) throw new TypeError('Placement policy requires at least one target root');
  return new Map(entries);
}
function freeMap(value, pathImpl) {
  if (!record(value)) return new Map();
  return new Map(Object.entries(value).map(([root, free]) => [pathImpl.resolve(root), bytes(free)]));
}
function duplicatePaths(scan, pathImpl) {
  return new Set((Array.isArray(scan.duplicates) ? scan.duplicates : []).flatMap((group) => Array.isArray(group?.paths) ? group.paths.filter((item) => typeof item === 'string').map((item) => pathImpl.resolve(item)) : []));
}
function validateScan(scan) { if (!record(scan) || !Array.isArray(scan.entries)) throw new TypeError('Placement policy requires a file insight scan'); return scan; }
function validateLimit(value) { if (!Number.isInteger(value) || value < 1 || value > 4096) throw new RangeError('Placement policy maxEntries is out of range'); return value; }
function sourceRoots(scan, value, pathImpl) { const roots = Array.isArray(value) ? value.filter((item) => text(item)).map((item) => pathImpl.resolve(item)) : []; return roots.length ? roots : text(scan.root) ? [pathImpl.resolve(scan.root)] : []; }

function protectedVolume(root, protectedRoots, pathImpl) {
  return protectedRoots.some((candidate) => {
    const resolved = pathImpl.resolve(candidate);
    return resolved === pathImpl.resolve(root) || isPathInside(resolved, root, pathImpl);
  });
}

function normalizeVolume(item, pathImpl) {
  if (!record(item)) return null;
  const root = text(item.mount ?? item.root);
  if (!root) return null;
  const freeBytes = bytes(item.freeBytes);
  return Object.freeze({
    mount: text(item.mount ?? item.root),
    root: pathImpl.resolve(root),
    freeBytes,
    mediaType: text(item.mediaType)?.toLowerCase() || 'unknown',
    health: text(item.health)?.toLowerCase() || 'unknown',
    volumeId: text(item.volumeId ?? item.uniqueId ?? item.device),
    physicalDiskNumber: Number.isInteger(item.physicalDiskNumber) && item.physicalDiskNumber >= 0 ? item.physicalDiskNumber : null,
    physicalDevicePath: text(item.physicalDevicePath),
    smart: item.smart,
    hardFailureEvidence: item.hardFailureEvidence,
    writable: item.writable !== false && item.readOnly !== true,
    protected: item.protected === true
  });
}

export function recommendPlacementTargets({
  volumes = [],
  categories = Object.keys(DEFAULT_MEDIA_PREFERENCES),
  mediaPreferences = DEFAULT_MEDIA_PREFERENCES,
  protectedRoots = [],
  drives = [],
  hardFailureEvidence = [],
  minFreeBytes = 0,
  pathImpl = path
} = {}) {
  if (!Array.isArray(volumes)) throw new TypeError('Placement recommendations require volume evidence');
  if (!Array.isArray(categories)) throw new TypeError('Placement recommendations require categories');
  if (!record(mediaPreferences)) throw new TypeError('Placement recommendations require media preferences');
  if (!Array.isArray(protectedRoots)) throw new TypeError('Placement recommendations require protected roots');
  if (!Number.isFinite(minFreeBytes) || minFreeBytes < 0) throw new RangeError('Placement recommendation free-space floor is invalid');
  const normalized = volumes.slice(0, 64).map((item) => normalizeVolume(item, pathImpl)).filter(Boolean);
  const candidates = normalized.map((item) => ({ ...item, storageSuitability: assessStorageSuitability({ volume: item, drives, hardFailureEvidence }) }))
    .filter((item) => item.writable && !item.protected && item.storageSuitability.admission === 'ALLOW' && item.freeBytes !== null && item.freeBytes >= minFreeBytes && !protectedVolume(item.root, protectedRoots, pathImpl));
  const recommendations = categories.slice(0, 32).map((value) => {
    const kind = category(value);
    const desiredMedia = text(mediaPreferences[kind])?.toLowerCase() || null;
    if (!desiredMedia) return Object.freeze({ category: kind, state: 'review-required', reason: 'category-needs-explicit-media-policy', targetRoot: null });
    const target = candidates.filter((item) => item.mediaType === desiredMedia).sort((left, right) => right.freeBytes - left.freeBytes)[0] || null;
    if (!target) return Object.freeze({ category: kind, state: 'no-safe-target', desiredMedia, reason: normalized.some((item) => item.mediaType !== 'unknown') ? 'no-volume-with-requested-media-type' : 'media-type-evidence-unavailable', targetRoot: null });
    return Object.freeze({ category: kind, state: 'recommended', desiredMedia, targetVolume: target.root, targetRoot: pathImpl.join(target.root, kind), freeBytes: target.freeBytes, storageSuitability: target.storageSuitability, reason: 'explicit-volume-and-physical-health-evidence-matches-category-policy' });
  });
  return Object.freeze({ version: FILE_PLACEMENT_POLICY_VERSION, state: recommendations.some((item) => item.state === 'recommended') ? 'recommendations-ready' : 'review-required', recommendations: Object.freeze(recommendations), candidateVolumes: Object.freeze(candidates), mutation: 'none', requiresApproval: true });
}

export function previewPlacementPolicy(scan, { targetRoots, sourceRoots: requestedRoots, protectedRoots = [], targetFreeBytes = {}, storageEvidence = null, maxEntries = 256, pathImpl = path } = {}) {
  validateScan(scan);
  const limit = validateLimit(maxEntries);
  const targets = targetMap(targetRoots, pathImpl);
  const sources = sourceRoots(scan, requestedRoots, pathImpl);
  if (!sources.length) throw new TypeError('Placement policy requires at least one source root');
  const free = freeMap(targetFreeBytes, pathImpl);
  const duplicates = duplicatePaths(scan, pathImpl);
  const groups = new Map();
  const skipped = [];
  for (const entry of scan.entries.slice(0, limit)) {
    const source = text(entry?.path);
    const kind = category(entry?.category);
    if (!source) { skipped.push({ entry, reason: 'file-path-evidence-unavailable' }); continue; }
    if (entry.protected === true) { skipped.push({ entry, reason: 'source-is-protected' }); continue; }
    if (SKIP_CATEGORIES.has(kind)) { skipped.push({ entry, reason: 'category-requires-review' }); continue; }
    if (duplicates.has(pathImpl.resolve(source))) { skipped.push({ entry, reason: 'duplicate-requires-review' }); continue; }
    const target = targets.get(kind);
    if (!target) { skipped.push({ entry, reason: 'category-has-no-approved-target' }); continue; }
    groups.set(target, [...(groups.get(target) || []), { ...entry, path: source, category: kind }]);
  }
  const plans = [...groups.entries()].map(([targetRoot, files]) => previewFilePlacement({ files, sourceRoots: sources, targetRoot, protectedRoots, storageEvidence, targetFreeBytes: free.get(targetRoot) ?? null, maxEntries: limit, pathImpl }));
  return Object.freeze({ version: FILE_PLACEMENT_POLICY_VERSION, state: plans.some((plan) => plan.moves.length) ? 'preview-ready' : 'no-safe-moves', sourceRoots: Object.freeze(sources), targetRoots: Object.freeze(Object.fromEntries(targets)), plans: Object.freeze(plans), skipped: Object.freeze(skipped), estimatedBytes: plans.reduce((sum, plan) => sum + plan.estimatedBytes, 0), mutation: 'none', requiresApproval: true });
}

function validPlan(plan) { if (!record(plan) || plan.version !== FILE_PLACEMENT_POLICY_VERSION || !Array.isArray(plan.plans)) throw new TypeError('Invalid placement policy plan'); return plan; }

export async function applyPlacementPolicy(plan, { approved = false, dryRun = true, fsImpl, pathImpl = path } = {}) {
  validPlan(plan);
  if (!approved && !dryRun) throw new Error('Placement policy requires explicit approval');
  if (dryRun) return Object.freeze({ dryRun: true, results: Object.freeze(plan.plans.map((item) => ({ dryRun: true, moved: [], skipped: item.moves.map((move) => ({ move, reason: 'dry-run' })) }))) });
  const results = [];
  for (const item of plan.plans) results.push(await applyFilePlacement(item, { approved: true, dryRun: false, fsImpl, pathImpl }));
  return Object.freeze({ dryRun: false, results: Object.freeze(results) });
}

export async function rollbackPlacementPolicy(result, { fsImpl, pathImpl = path } = {}) {
  if (!record(result) || !Array.isArray(result.results)) throw new TypeError('Invalid placement policy result');
  const rollbacks = [];
  for (const item of [...result.results].reverse()) rollbacks.push(await rollbackFilePlacement(item, { fsImpl, pathImpl }));
  return Object.freeze({ rollbacks: Object.freeze(rollbacks) });
}
