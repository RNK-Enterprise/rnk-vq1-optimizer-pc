/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Local Storage Pressure Guard. It observes the system drive, keeps pagefile
 * pressure separate from reclaimable files, and only plans bounded work under
 * explicit category and approval policy.
 */

import fs from 'fs/promises';
import path from 'path';
import {
  STORAGE_CATEGORY_IDS,
  categoryPolicy,
  isPathInside,
  isProtectedStoragePath,
  resolveProtectedStorageRoots,
  resolveStorageCategoryRoots
} from './storage-targets.js';
import { collectDarwinSwapPressure, collectLinuxSwapPressure } from './swap-pressure.js';

export const STORAGE_PRESSURE_POLICY_VERSION = 1;
export const STORAGE_PRESSURE_LEVELS = Object.freeze(['normal', 'warning', 'critical', 'emergency', 'unknown']);
export const PAGEFILE_MANAGEMENT_STATES = Object.freeze(['ENABLED', 'DISABLED', 'UNKNOWN']);
export const COMMIT_STATES = Object.freeze(['OBSERVED', 'UNAVAILABLE']);
export const DEFAULT_STORAGE_PRESSURE_POLICY = Object.freeze({
  warningPercent: 20,
  criticalPercent: 10,
  emergencyPercent: 5,
  targetFreeBytes: 5 * 1024 ** 3,
  minAgeHours: 24,
  maxEntries: 2000,
  maxDepth: 3
});

const WINDOWS_STORAGE_COMMAND = Object.freeze([
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy', 'Bypass',
  '-Command',
  "$drive = [Environment]::SystemDirectory.Substring(0,2); $disk = Get-CimInstance Win32_LogicalDisk -Filter (\"DeviceID='{0}'\" -f $drive); $computer = Get-CimInstance Win32_ComputerSystem; $memory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory; $pages = @(Get-CimInstance Win32_PageFileUsage | Select-Object Name,AllocatedBaseSize,CurrentUsage,PeakUsage); [pscustomobject]@{drive=$disk.DeviceID; totalBytes=[int64]$disk.Size; freeBytes=[int64]$disk.FreeSpace; automaticManagedPagefile=[bool]$computer.AutomaticManagedPagefile; committedBytes=[int64]$memory.CommittedBytes; commitLimitBytes=[int64]$memory.CommitLimit; freeCommitBytes=[Math]::Max(0, ([int64]$memory.CommitLimit - [int64]$memory.CommittedBytes)); observedAt=(Get-Date).ToUniversalTime().ToString('o'); source='Win32_PageFileUsage+Win32_ComputerSystem+Win32_PerfFormattedData_PerfOS_Memory'; pagefiles=$pages} | ConvertTo-Json -Compress"
]);

function nonNegative(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function validatePolicy(input = {}) {
  const policy = { ...DEFAULT_STORAGE_PRESSURE_POLICY, ...input };
  const percentages = [policy.warningPercent, policy.criticalPercent, policy.emergencyPercent];
  if (percentages.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new RangeError('Storage pressure percentages must be between 0 and 100');
  }
  if (!(policy.warningPercent > policy.criticalPercent && policy.criticalPercent > policy.emergencyPercent)) {
    throw new RangeError('Storage pressure percentages must be warning > critical > emergency');
  }
  if (!Number.isFinite(policy.targetFreeBytes) || policy.targetFreeBytes < 0) {
    throw new RangeError('Storage pressure targetFreeBytes must be non-negative');
  }
  if (!Number.isFinite(policy.minAgeHours) || policy.minAgeHours < 1 || policy.minAgeHours > 24 * 365) {
    throw new RangeError('Storage pressure minAgeHours must be between 1 and 8760');
  }
  if (!Number.isInteger(policy.maxEntries) || policy.maxEntries < 1 || policy.maxEntries > 10000) {
    throw new RangeError('Storage pressure maxEntries must be an integer between 1 and 10000');
  }
  if (!Number.isInteger(policy.maxDepth) || policy.maxDepth < 0 || policy.maxDepth > 8) {
    throw new RangeError('Storage pressure maxDepth must be an integer between 0 and 8');
  }
  return Object.freeze(policy);
}

function percent(freeBytes, totalBytes) {
  if (freeBytes === null || totalBytes === null || totalBytes <= 0) return null;
  return Math.min(100, Math.max(0, (Math.min(freeBytes, totalBytes) / totalBytes) * 100));
}

export function classifyStoragePressure({ freeBytes, totalBytes } = {}, inputPolicy = {}) {
  const policy = validatePolicy(inputPolicy);
  const free = nonNegative(freeBytes);
  const total = nonNegative(totalBytes);
  const freePercent = percent(free, total);
  const belowTargetFreeFloor = free !== null && free < policy.targetFreeBytes;
  let level = 'unknown';
  if (freePercent !== null) {
    if (freePercent <= policy.emergencyPercent) level = 'emergency';
    else if (freePercent <= policy.criticalPercent || belowTargetFreeFloor) level = 'critical';
    else if (freePercent <= policy.warningPercent) level = 'warning';
    else level = 'normal';
  }
  return Object.freeze({
    level,
    totalBytes: total,
    freeBytes: free,
    freePercent,
    targetFreeBytes: policy.targetFreeBytes,
    belowTargetFreeFloor,
    reclaimableBytesNeeded: free === null ? null : Math.max(0, policy.targetFreeBytes - free),
    policyVersion: STORAGE_PRESSURE_POLICY_VERSION
  });
}

function booleanOrNull(value) { return typeof value === 'boolean' ? value : null; }

function normalizePagefiles(pagefiles, facts = {}) {
  const rows = Array.isArray(pagefiles) ? pagefiles : pagefiles ? [pagefiles] : [];
  const normalized = rows.map((pagefile) => ({
    name: typeof pagefile?.Name === 'string' ? pagefile.Name : null,
    allocatedBytes: nonNegative(pagefile?.AllocatedBaseSize) === null ? null : nonNegative(pagefile.AllocatedBaseSize) * 1024 * 1024,
    currentBytes: nonNegative(pagefile?.CurrentUsage) === null ? null : nonNegative(pagefile.CurrentUsage) * 1024 * 1024,
    peakBytes: nonNegative(pagefile?.PeakUsage) === null ? null : nonNegative(pagefile.PeakUsage) * 1024 * 1024
  }));
  const allocatedBytes = normalized.map((item) => item.allocatedBytes).filter((value) => value !== null).reduce((sum, value) => sum + value, 0);
  const currentBytes = normalized.map((item) => item.currentBytes).filter((value) => value !== null).reduce((sum, value) => sum + value, 0);
  const peakBytes = normalized.map((item) => item.peakBytes).filter((value) => value !== null).reduce((sum, value) => sum + value, 0);
  const committedBytes = nonNegative(facts.committedBytes);
  const commitLimitBytes = nonNegative(facts.commitLimitBytes);
  const freeCommitBytes = nonNegative(facts.freeCommitBytes) ?? (committedBytes !== null && commitLimitBytes !== null ? Math.max(0, commitLimitBytes - committedBytes) : null);
  const systemManaged = booleanOrNull(facts.automaticManagedPagefile ?? facts.systemManaged);
  const managementStatus = systemManaged === true ? 'ENABLED' : systemManaged === false ? 'DISABLED' : 'UNKNOWN';
  const commitStatus = committedBytes !== null && commitLimitBytes !== null && freeCommitBytes !== null ? 'OBSERVED' : 'UNAVAILABLE';
  return Object.freeze({
    available: normalized.length > 0 || committedBytes !== null || commitLimitBytes !== null || freeCommitBytes !== null || systemManaged !== null,
    systemManaged,
    managementStatus,
    files: Object.freeze(normalized),
    allocatedBytes: normalized.some((item) => item.allocatedBytes !== null) && allocatedBytes > 0 ? allocatedBytes : null,
    currentBytes: normalized.some((item) => item.currentBytes !== null) && currentBytes > 0 ? currentBytes : null,
    peakBytes: normalized.some((item) => item.peakBytes !== null) && peakBytes > 0 ? peakBytes : null,
    pressurePercent: allocatedBytes > 0 && currentBytes !== null ? Math.min(100, (currentBytes / allocatedBytes) * 100) : null,
    committedBytes,
    commitLimitBytes,
    freeCommitBytes,
    commitPressurePercent: commitLimitBytes > 0 && committedBytes !== null ? Math.min(100, (committedBytes / commitLimitBytes) * 100) : null,
    commitStatus,
    observedAt: typeof facts.observedAt === 'string' && facts.observedAt.trim() ? facts.observedAt.trim() : null,
    source: typeof facts.source === 'string' && facts.source.trim() ? facts.source.trim() : 'pagefile evidence unavailable',
    cleanup: 'never'
  });
}

export function parseWindowsStorageOutput(output, policy = {}) {
  let parsed;
  try {
    parsed = JSON.parse(String(output || ''));
  } catch {
    return null;
  }
  const totalBytes = nonNegative(parsed?.totalBytes);
  const freeBytes = nonNegative(parsed?.freeBytes);
  if (totalBytes === null || freeBytes === null) return null;
  const mount = typeof parsed.drive === 'string' ? parsed.drive : null;
  return {
    storage: [{ mount, device: mount, totalBytes, freeBytes, health: 'unknown', readOnly: false }],
    pagefile: normalizePagefiles(parsed.pagefiles, parsed),
    pressure: classifyStoragePressure({ totalBytes, freeBytes }, policy)
  };
}

export function parseLinuxDfOutput(output, policy = {}) {
  const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
  const line = lines.at(-1);
  if (!line) return null;
  const fields = line.trim().split(/\s+/);
  if (fields.length < 6) return null;
  const totalBytes = nonNegative(fields[1]);
  const freeBytes = nonNegative(fields[3]);
  if (totalBytes === null || freeBytes === null) return null;
  const mount = fields.slice(5).join(' ');
  return {
    storage: [{ mount, device: fields[0], totalBytes, freeBytes, health: 'unknown', readOnly: false }],
    pagefile: Object.freeze({ available: false, systemManaged: true, files: Object.freeze([]), allocatedBytes: null, currentBytes: null, pressurePercent: null, cleanup: 'never' }),
    pressure: classifyStoragePressure({ totalBytes, freeBytes }, policy)
  };
}

export function parseDarwinDfOutput(output, policy = {}) {
  const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
  const line = lines.at(-1);
  if (!line) return null;
  const fields = line.trim().split(/\s+/);
  if (fields.length < 6) return null;
  const totalBlocks = nonNegative(fields[1]);
  const freeBlocks = nonNegative(fields[3]);
  if (totalBlocks === null || freeBlocks === null) return null;
  const totalBytes = totalBlocks * 1024;
  const freeBytes = freeBlocks * 1024;
  const mount = fields.slice(5).join(' ');
  return {
    storage: [{ mount, device: fields[0], totalBytes, freeBytes, health: 'unknown', readOnly: false }],
    pagefile: Object.freeze({ available: false, systemManaged: true, files: Object.freeze([]), allocatedBytes: null, currentBytes: null, pressurePercent: null, cleanup: 'never' }),
    pressure: classifyStoragePressure({ totalBytes, freeBytes }, policy)
  };
}

export async function collectStoragePressureSnapshot({
  platform = process.platform,
  commandRunner,
  policy = {},
  now = Date.now
} = {}) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Storage pressure clock must return a number');
  if (!commandRunner || typeof commandRunner.run !== 'function') {
    return { available: false, platform, storage: [], pagefile: normalizePagefiles(), pressure: classifyStoragePressure({}, policy), collectedAt: new Date(timestamp).toISOString(), reason: 'command runner unavailable' };
  }
  const command = platform === 'win32'
    ? ['powershell.exe', WINDOWS_STORAGE_COMMAND, { timeoutMs: 5000, maxOutputBytes: 8192 }]
    : platform === 'linux'
      ? ['df', ['-P', '-B1', '--', '/'], { timeoutMs: 2500, maxOutputBytes: 4096 }]
      : platform === 'darwin'
        ? ['df', ['-Pk', '/'], { timeoutMs: 2500, maxOutputBytes: 4096 }]
      : null;
  if (!command) {
    return { available: false, platform, storage: [], pagefile: normalizePagefiles(), pressure: classifyStoragePressure({}, policy), collectedAt: new Date(timestamp).toISOString(), reason: 'platform unsupported' };
  }
  try {
    const result = await commandRunner.run(command[0], command[1], command[2]);
    if (result?.code !== 0) throw new Error(result?.stderr || 'storage command failed');
    const parsed = platform === 'win32'
      ? parseWindowsStorageOutput(result.stdout, policy)
      : platform === 'linux' ? parseLinuxDfOutput(result.stdout, policy) : parseDarwinDfOutput(result.stdout, policy);
    if (!parsed) throw new Error('storage command returned invalid facts');
    const pagefile = platform === 'linux'
      ? await collectLinuxSwapPressure({ commandRunner })
      : platform === 'darwin' ? await collectDarwinSwapPressure({ commandRunner }) : parsed.pagefile;
    return { available: true, platform, ...parsed, pagefile, collectedAt: new Date(timestamp).toISOString() };
  } catch (error) {
    return { available: false, platform, storage: [], pagefile: normalizePagefiles(), pressure: classifyStoragePressure({}, policy), collectedAt: new Date(timestamp).toISOString(), reason: error.message };
  }
}

function candidateEligibility(category, enabledCategories, allowUnsafeCategories, allowAdmin) {
  const policy = categoryPolicy(category);
  if (!enabledCategories.includes(category)) return { eligible: false, reason: 'category-disabled' };
  if (!policy.safeByDefault && allowUnsafeCategories !== true) return { eligible: false, reason: 'explicit-category-approval-required' };
  if (policy.requiresAdmin && allowAdmin !== true) return { eligible: false, reason: 'admin-approval-required' };
  return { eligible: true, reason: null };
}

async function walkFiles(root, category, options, state, depth = 0) {
  if (state.candidates.length >= options.maxEntries || depth > options.maxDepth) return;
  if (isProtectedStoragePath(root, options.protectedRoots, options.pathImpl)) return;
  let entries;
  try {
    entries = await options.fsImpl.readdir(root, { withFileTypes: true });
  } catch {
    state.unreadableRoots += 1;
    return;
  }
  for (const entry of entries) {
    if (state.candidates.length >= options.maxEntries) break;
    const candidatePath = options.pathImpl.join(root, entry.name);
    if (isProtectedStoragePath(candidatePath, options.protectedRoots, options.pathImpl)) {
      state.protectedCount += 1;
      continue;
    }
    let info;
    try {
      info = await options.fsImpl.lstat(candidatePath);
    } catch {
      state.raceCount += 1;
      continue;
    }
    if (info.isSymbolicLink()) {
      state.symlinkCount += 1;
      continue;
    }
    if (info.isDirectory()) {
      await walkFiles(candidatePath, category, options, state, depth + 1);
      continue;
    }
    if (!info.isFile() || info.mtimeMs > options.cutoff) continue;
    const bytes = nonNegative(info.size) || 0;
    const eligibility = candidateEligibility(category, options.enabledCategories, options.allowUnsafeCategories, options.allowAdmin);
    const candidate = {
      category,
      path: candidatePath,
      root,
      sizeBytes: bytes,
      modifiedAt: new Date(info.mtimeMs).toISOString(),
      eligible: eligibility.eligible,
      reason: eligibility.reason
    };
    state.candidates.push(candidate);
    state.observedBytes += bytes;
    if (candidate.eligible) state.eligibleBytes += bytes;
  }
}

function validateCategories(categories) {
  const values = Array.isArray(categories) ? categories : [];
  const unknown = values.filter((category) => !STORAGE_CATEGORY_IDS.includes(category));
  if (unknown.length) throw new Error(`Unsupported storage category: ${unknown[0]}`);
  return [...new Set(values)];
}

export async function previewStorageCleanup({
  snapshot,
  platform = process.platform,
  env = process.env,
  fsImpl = fs,
  pathImpl = path,
  policy = {},
  enabledCategories = [],
  protectedRoots = [],
  abandonedRuntimeRoots = [],
  allowUnsafeCategories = false,
  allowAdmin = false,
  now = Date.now
} = {}) {
  const normalizedPolicy = validatePolicy(policy);
  const categories = validateCategories(enabledCategories);
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Storage pressure clock must return a number');
  const pressureSnapshot = snapshot || { available: false, storage: [], pressure: classifyStoragePressure({}, normalizedPolicy) };
  const pressure = pressureSnapshot.pressure || classifyStoragePressure(pressureSnapshot.storage?.[0] || {}, normalizedPolicy);
  const rootsByCategory = resolveStorageCategoryRoots({ platform, env, pathImpl, abandonedRuntimeRoots });
  const protectedPathRoots = resolveProtectedStorageRoots({ platform, env, pathImpl, protectedRoots });
  const state = { candidates: [], observedBytes: 0, eligibleBytes: 0, protectedCount: 0, symlinkCount: 0, raceCount: 0, unreadableRoots: 0 };
  for (const category of STORAGE_CATEGORY_IDS) {
    for (const root of rootsByCategory[category]) {
      await walkFiles(root, category, {
        fsImpl, pathImpl, protectedRoots: protectedPathRoots, enabledCategories: categories,
        allowUnsafeCategories, allowAdmin, cutoff: timestamp - normalizedPolicy.minAgeHours * 60 * 60 * 1000,
        maxEntries: normalizedPolicy.maxEntries, maxDepth: normalizedPolicy.maxDepth
      }, state);
    }
  }
  const plan = buildStorageCleanupPlan({ pressure, candidates: state.candidates, protectedRoots: protectedPathRoots }, { now: timestamp });
  const byCategory = Object.fromEntries(STORAGE_CATEGORY_IDS.map((category) => {
    const rows = state.candidates.filter((candidate) => candidate.category === category);
    return [category, {
      candidateCount: rows.length,
      observedBytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
      eligibleBytes: rows.filter((row) => row.eligible).reduce((sum, row) => sum + row.sizeBytes, 0),
      enabled: categories.includes(category)
    }];
  }));
  return Object.freeze({
    previewVersion: 1,
    generatedAt: new Date(timestamp).toISOString(),
    platform,
    pressure,
    policy: normalizedPolicy,
    protectedRoots: Object.freeze(protectedPathRoots),
    categories: Object.freeze(byCategory),
    candidates: Object.freeze(state.candidates),
    observedBytes: state.observedBytes,
    eligibleBytes: state.eligibleBytes,
    protectedCount: state.protectedCount,
    symlinkCount: state.symlinkCount,
    raceCount: state.raceCount,
    unreadableRoots: state.unreadableRoots,
    plan
  });
}

export function buildStorageCleanupPlan({ pressure, candidates = [], protectedRoots = [] } = {}, { now = Date.now() } = {}) {
  const available = pressure?.level === 'critical' || pressure?.level === 'emergency';
  const needed = pressure?.reclaimableBytesNeeded;
  const selected = [];
  let remaining = Number.isFinite(needed) ? needed : 0;
  const ordered = candidates.filter((candidate) => candidate.eligible).sort((left, right) => right.sizeBytes - left.sizeBytes);
  if (available && remaining > 0) {
    for (const candidate of ordered) {
      selected.push(candidate);
      remaining -= candidate.sizeBytes;
      if (remaining <= 0) break;
    }
  }
  return Object.freeze({
    planVersion: 1,
    planId: `storage-${now}`,
    available,
    approvalRequired: true,
    targetFreeBytes: pressure?.targetFreeBytes ?? null,
    requiredBytes: Number.isFinite(needed) ? needed : null,
    estimatedBytes: selected.reduce((sum, candidate) => sum + candidate.sizeBytes, 0),
    selected: Object.freeze(selected),
    protectedRoots: Object.freeze(protectedRoots),
    reason: available ? (selected.length ? 'bounded-cleanup-available' : 'target-floor-already-met-or-no-eligible-candidates') : 'cleanup-offered-at-critical-or-emergency-only'
  });
}

export async function executeStorageCleanupPlan(plan, {
  approved = false,
  dryRun = true,
  fsImpl = fs,
  pathImpl = path,
  protectedRoots = plan?.protectedRoots || [],
  readSnapshot,
  now = Date.now
} = {}) {
  if (!plan || plan.planVersion !== 1 || !Array.isArray(plan.selected)) throw new TypeError('Storage cleanup requires a valid preview plan');
  if (!dryRun && approved !== true) throw new Error('Storage cleanup requires explicit approval');
  const before = typeof readSnapshot === 'function' ? await readSnapshot() : null;
  if (dryRun) {
    return { dryRun: true, removed: [], skipped: plan.selected.map((item) => ({ path: item.path, reason: 'dry-run' })), audit: { planId: plan.planId, estimatedBytes: plan.estimatedBytes, removedBytes: 0, spaceRecoveredBytes: 0, before, after: before } };
  }
  const removed = [];
  const skipped = [];
  for (const item of plan.selected) {
    if (!isPathInside(item.root, item.path, pathImpl) || isProtectedStoragePath(item.path, protectedRoots, pathImpl)) {
      skipped.push({ path: item.path, reason: 'protected-or-outside-approved-root' });
      continue;
    }
    try {
      const info = await fsImpl.lstat(item.path);
      if (info.isSymbolicLink() || !info.isFile()) {
        skipped.push({ path: item.path, reason: info.isSymbolicLink() ? 'symlink' : 'not-a-file' });
        continue;
      }
      await fsImpl.rm(item.path, { force: false });
      removed.push({ path: item.path, sizeBytes: nonNegative(info.size) || 0, category: item.category });
    } catch (error) {
      skipped.push({ path: item.path, reason: error.message });
    }
  }
  const after = typeof readSnapshot === 'function' ? await readSnapshot() : null;
  const removedBytes = removed.reduce((sum, item) => sum + item.sizeBytes, 0);
  const beforeFreeBytes = before?.pressure?.freeBytes;
  const afterFreeBytes = after?.pressure?.freeBytes;
  const spaceRecoveredBytes = Number.isFinite(beforeFreeBytes) && Number.isFinite(afterFreeBytes)
    ? Math.max(0, afterFreeBytes - beforeFreeBytes)
    : null;
  return {
    dryRun: false,
    removed,
    skipped,
    audit: {
      planId: plan.planId,
      estimatedBytes: plan.estimatedBytes,
      removedBytes,
      spaceRecoveredBytes,
      before,
      after,
      recordedAt: new Date(now()).toISOString()
    }
  };
}

export function createStoragePressureGuard(options = {}) {
  const configuration = { ...options, policy: validatePolicy(options.policy) };
  const readSnapshot = () => collectStoragePressureSnapshot(configuration);
  return Object.freeze({
    policy: configuration.policy,
    snapshot: readSnapshot,
    preview: async (previewOptions = {}) => {
      const snapshot = previewOptions.snapshot || await readSnapshot();
      return previewStorageCleanup({ ...configuration, ...previewOptions, snapshot });
    },
    cleanup: async (plan, cleanupOptions = {}) => executeStorageCleanupPlan(plan, {
      ...cleanupOptions,
      readSnapshot,
      protectedRoots: plan?.protectedRoots || cleanupOptions.protectedRoots
    }),
    monitor: (monitorOptions = {}) => createStoragePressureMonitor({ ...monitorOptions, readSnapshot })
  });
}

export function createStoragePressureMonitor({
  readSnapshot,
  intervalMs = 60000,
  onSample = async () => {},
  onChange = async () => {},
  onError = () => {},
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
} = {}) {
  if (typeof readSnapshot !== 'function') throw new TypeError('Storage pressure monitor requires readSnapshot');
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('Storage pressure monitor interval must be positive');
  if (typeof onSample !== 'function') throw new TypeError('Storage pressure monitor sample callback must be callable');
  let active = false;
  let timer = null;
  let lastKey = null;
  const poll = async () => {
    const snapshot = await readSnapshot();
    await onSample(snapshot);
    const pressure = snapshot?.pressure || {};
    const key = `${pressure.level || 'unknown'}:${pressure.belowTargetFreeFloor === true}`;
    const changed = key !== lastKey;
    if (changed) {
      lastKey = key;
      await onChange(snapshot);
    }
    return { ...snapshot, changed };
  };
  const start = async () => {
    if (active) return poll();
    active = true;
    timer = setIntervalImpl(() => { poll().catch(onError); }, intervalMs);
    return poll();
  };
  const stop = () => {
    if (active) clearIntervalImpl(timer);
    active = false;
    timer = null;
    return true;
  };
  return Object.freeze({ poll, start, stop });
}
