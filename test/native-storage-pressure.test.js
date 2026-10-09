/**
 * Native storage-pressure guard tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  DEFAULT_STORAGE_PRESSURE_POLICY,
  STORAGE_PRESSURE_LEVELS,
  buildStorageCleanupPlan,
  classifyStoragePressure,
  collectStoragePressureSnapshot,
  createStoragePressureGuard,
  createStoragePressureMonitor,
  executeStorageCleanupPlan,
  parseLinuxDfOutput,
  parseDarwinDfOutput,
  parseWindowsStorageOutput,
  previewStorageCleanup
} from '../native/storage-pressure.js';
import {
  STORAGE_CATEGORY_IDS,
  STORAGE_CATEGORY_POLICIES,
  categoryPolicy,
  defaultProtectedStorageRoots,
  isPathInside,
  isProtectedStoragePath,
  resolveProtectedStorageRoots,
  resolveStorageCategoryRoots
} from '../native/storage-targets.js';

const NOW = Date.parse('2030-01-02T00:00:00.000Z');

async function olden(file, timestamp = NOW - 48 * 60 * 60 * 1000) {
  await fs.utimes(file, timestamp / 1000, timestamp / 1000);
}

function envFor(root) {
  const local = path.join(root, 'local');
  const user = path.join(root, 'user');
  return {
    TEMP: path.join(root, 'temp'),
    TMP: path.join(root, 'tmp'),
    LOCALAPPDATA: local,
    USERPROFILE: user,
    HOME: user,
    SystemRoot: path.join(root, 'windows'),
    PROJECTS_ROOT: path.join(root, 'projects'),
    MODELS_ROOT: path.join(root, 'models'),
    CREDENTIALS_ROOT: path.join(root, 'credentials'),
    WSL_DATA_ROOT: path.join(root, 'wsl'),
    ACTIVE_RUNTIME_ROOT: path.join(root, 'active-runtime'),
    CODEX_RUNTIME_ROOT: path.join(root, 'codex-runtime'),
    OPENCODE_RUNTIME_ROOT: path.join(root, 'opencode-runtime'),
    RUNTIMES_ROOT: path.join(root, 'runtimes')
  };
}

function pressure(overrides = {}) {
  return {
    level: 'critical',
    totalBytes: 1000,
    freeBytes: 0,
    freePercent: 0,
    targetFreeBytes: 100,
    belowTargetFreeFloor: true,
    reclaimableBytesNeeded: 100,
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    available: true,
    platform: 'linux',
    storage: [{ mount: '/', totalBytes: 1000, freeBytes: 0 }],
    pagefile: { available: false, cleanup: 'never' },
    pressure: pressure(),
    ...overrides
  };
}

describe('native storage target policy', () => {
  test('publishes fixed categories and policies', () => {
    expect(STORAGE_CATEGORY_IDS).toEqual([
      'temporary-files', 'package-cache', 'browser-automation-cache',
      'gpu-shader-cache', 'windows-update-download', 'abandoned-runtime-remnants'
    ]);
    expect(Object.isFrozen(STORAGE_CATEGORY_IDS)).toBe(true);
    expect(STORAGE_CATEGORY_POLICIES['temporary-files']).toEqual({ safeByDefault: true, requiresAdmin: false });
    expect(categoryPolicy('missing')).toBeNull();
    expect(Object.isFrozen(STORAGE_CATEGORY_POLICIES)).toBe(true);
  });

  test('resolves only explicit known roots and protected roots', () => {
    const root = '/tmp/rnk-storage';
    const env = envFor(root);
    const categories = resolveStorageCategoryRoots({
      platform: 'win32', env, abandonedRuntimeRoots: [path.join(root, 'abandoned'), path.join(root, 'abandoned')]
    });
    expect(categories['temporary-files']).toEqual([env.TEMP, env.TMP, path.join(env.LOCALAPPDATA, 'Temp')]);
    expect(categories['package-cache']).toContain(path.join(env.USERPROFILE, '.npm'));
    expect(categories['browser-automation-cache']).toHaveLength(4);
    expect(categories['gpu-shader-cache']).toHaveLength(5);
    expect(categories['windows-update-download'][0]).toContain('SoftwareDistribution');
    expect(categories['abandoned-runtime-remnants']).toEqual([path.join(root, 'abandoned')]);
    expect(resolveStorageCategoryRoots()).toHaveProperty('temporary-files');
    expect(resolveStorageCategoryRoots({ platform: 'win32', env: {} })['windows-update-download'][0]).toContain('C:');
    expect(resolveStorageCategoryRoots({ platform: 'linux', env: {} })['windows-update-download']).toEqual([]);
    expect(resolveStorageCategoryRoots({ platform: 'linux', env: { HOME: root } })['package-cache']).toContain(path.join(root, '.npm'));
    expect(resolveStorageCategoryRoots({ platform: 'linux', env: { USERPROFILE: root } })['package-cache']).toContain(path.join(root, '.npm'));
    expect(resolveStorageCategoryRoots({ platform: 'linux', env: {}, abandonedRuntimeRoots: 'not-a-list' })['temporary-files']).toEqual([]);
    expect(defaultProtectedStorageRoots({ platform: 'win32', env }).some((item) => item.endsWith('System32'))).toBe(true);
    expect(defaultProtectedStorageRoots({ platform: 'win32', env })).toEqual(expect.arrayContaining([
      path.join(root, 'active-runtime'), path.join(root, 'codex-runtime'), path.join(root, 'opencode-runtime'), path.join(root, 'runtimes')
    ]));
    expect(defaultProtectedStorageRoots({ platform: 'linux', env: {} })).toEqual([]);
    expect(defaultProtectedStorageRoots()).toEqual(expect.any(Array));
    expect(defaultProtectedStorageRoots({ platform: 'win32', env: { HOME: root, WINDIR: '/windows' } })).toContain('/windows/System32');
    expect(resolveProtectedStorageRoots({ env, protectedRoots: [path.join(root, 'projects'), path.join(root, 'extra')] })).toContain(path.join(root, 'extra'));
    expect(resolveProtectedStorageRoots()).toEqual(expect.any(Array));
  });

  test('enforces path and system-file protection', () => {
    const root = '/tmp/rnk-storage-root';
    expect(isPathInside(root, path.join(root, 'file'))).toBe(true);
    expect(isPathInside(root, root)).toBe(false);
    expect(isPathInside(root, '/tmp/other')).toBe(false);
    expect(isPathInside(null, root)).toBe(false);
    expect(isPathInside(root, null)).toBe(false);
    expect(isProtectedStoragePath('', [])).toBe(true);
    expect(isProtectedStoragePath(path.join(root, 'pagefile.sys'), [])).toBe(true);
    expect(isProtectedStoragePath(path.join(root, 'safe.tmp'), [root])).toBe(true);
    expect(isProtectedStoragePath(path.join(root, 'safe.tmp'), [])).toBe(false);
    expect(isProtectedStoragePath(root, [root])).toBe(true);
    expect(isProtectedStoragePath(path.join(root, 'safe.tmp'))).toBe(false);
    expect(isProtectedStoragePath(null, [])).toBe(true);
  });
});

describe('native storage pressure classification and collection', () => {
  test('classifies normal, warning, critical, emergency, floor, and unknown states', () => {
    expect(STORAGE_PRESSURE_LEVELS).toEqual(['normal', 'warning', 'critical', 'emergency', 'unknown']);
    expect(DEFAULT_STORAGE_PRESSURE_POLICY.targetFreeBytes).toBe(5 * 1024 ** 3);
    expect(classifyStoragePressure({ totalBytes: 1000, freeBytes: 500 }, { targetFreeBytes: 0 }).level).toBe('normal');
    expect(classifyStoragePressure({ totalBytes: 1000, freeBytes: 200 }, { targetFreeBytes: 0 }).level).toBe('warning');
    expect(classifyStoragePressure({ totalBytes: 1000, freeBytes: 100 }, { targetFreeBytes: 0 }).level).toBe('critical');
    expect(classifyStoragePressure({ totalBytes: 1000, freeBytes: 50 }, { targetFreeBytes: 0 }).level).toBe('emergency');
    expect(classifyStoragePressure({ totalBytes: 1000, freeBytes: 900 }, { targetFreeBytes: 950 }).level).toBe('critical');
    expect(classifyStoragePressure({ totalBytes: 1000, freeBytes: 2000 }, { targetFreeBytes: 0 })).toMatchObject({ freePercent: 100, reclaimableBytesNeeded: 0 });
    expect(classifyStoragePressure({ totalBytes: 0, freeBytes: 0 }, { targetFreeBytes: 0 })).toMatchObject({ level: 'unknown', freePercent: null });
    expect(classifyStoragePressure({ totalBytes: 'bad', freeBytes: -1 }, { targetFreeBytes: 0 })).toMatchObject({ level: 'unknown', freeBytes: null, totalBytes: null });
    expect(classifyStoragePressure()).toMatchObject({ level: 'unknown', freeBytes: null, totalBytes: null });
  });

  test('rejects unsafe or malformed pressure policy values', () => {
    expect(() => classifyStoragePressure({}, { warningPercent: 101 })).toThrow('between 0 and 100');
    expect(() => classifyStoragePressure({}, { warningPercent: 10, criticalPercent: 20 })).toThrow('warning > critical');
    expect(() => classifyStoragePressure({}, { targetFreeBytes: -1 })).toThrow('targetFreeBytes');
    expect(() => classifyStoragePressure({}, { minAgeHours: 0 })).toThrow('minAgeHours');
    expect(() => classifyStoragePressure({}, { minAgeHours: 9000 })).toThrow('minAgeHours');
    expect(() => classifyStoragePressure({}, { maxEntries: 0 })).toThrow('maxEntries');
    expect(() => classifyStoragePressure({}, { maxEntries: 10001 })).toThrow('maxEntries');
    expect(() => classifyStoragePressure({}, { maxEntries: 1.5 })).toThrow('maxEntries');
    expect(() => classifyStoragePressure({}, { maxDepth: -1 })).toThrow('maxDepth');
    expect(() => classifyStoragePressure({}, { maxDepth: 9 })).toThrow('maxDepth');
    expect(() => classifyStoragePressure({}, { maxDepth: 1.5 })).toThrow('maxDepth');
  });

  test('parses Windows facts and separates pagefile cleanup', () => {
    const parsed = parseWindowsStorageOutput(JSON.stringify({
      drive: 'C:', totalBytes: '1000', freeBytes: '500',
      pagefiles: [{ Name: 'C:\\pagefile.sys', AllocatedBaseSize: 100, CurrentUsage: 25, PeakUsage: 50 }]
    }), { targetFreeBytes: 0 });
    expect(parsed.storage[0]).toMatchObject({ mount: 'C:', device: 'C:', totalBytes: 1000, freeBytes: 500 });
    expect(parsed.pagefile).toMatchObject({ available: true, allocatedBytes: 100 * 1024 * 1024, currentBytes: 25 * 1024 * 1024, pressurePercent: 25, cleanup: 'never' });
    expect(parseWindowsStorageOutput(JSON.stringify({ totalBytes: 100, freeBytes: 50, pagefiles: { Name: 'x', AllocatedBaseSize: 0, CurrentUsage: 0, PeakUsage: -1 } }), { targetFreeBytes: 0 }).pagefile).toMatchObject({ available: true, allocatedBytes: null, currentBytes: null, pressurePercent: null });
    expect(parseWindowsStorageOutput(JSON.stringify({ totalBytes: 100, freeBytes: 50, pagefiles: null }), { targetFreeBytes: 0 }).pagefile.available).toBe(false);
    expect(parseWindowsStorageOutput(JSON.stringify({ totalBytes: 100, freeBytes: 50, pagefiles: false }), { targetFreeBytes: 0 }).pagefile.available).toBe(false);
    expect(parseWindowsStorageOutput(JSON.stringify({ totalBytes: 100, freeBytes: 50, pagefiles: { AllocatedBaseSize: -1, CurrentUsage: -1, PeakUsage: 'bad' } }), { targetFreeBytes: 0 }).pagefile.files[0]).toEqual({ name: null, allocatedBytes: null, currentBytes: null, peakBytes: null });
    expect(parseWindowsStorageOutput('not-json')).toBeNull();
    expect(parseWindowsStorageOutput()).toBeNull();
    expect(parseWindowsStorageOutput(JSON.stringify({ totalBytes: 100 }))).toBeNull();
    expect(parseWindowsStorageOutput(JSON.stringify({ totalBytes: -1, freeBytes: 1 }))).toBeNull();
  });

  test('parses Linux df output and rejects malformed output', () => {
    const parsed = parseLinuxDfOutput('Filesystem 1B-blocks Used Available Capacity Mounted on\n/dev/root 1000 500 500 50% /\n', { targetFreeBytes: 0 });
    expect(parsed.storage[0]).toMatchObject({ mount: '/', device: '/dev/root', totalBytes: 1000, freeBytes: 500 });
    expect(parsed.pagefile).toMatchObject({ available: false, cleanup: 'never' });
    expect(parseLinuxDfOutput('')).toBeNull();
    expect(parseLinuxDfOutput('one two three')).toBeNull();
    expect(parseLinuxDfOutput('fs bad used free cap /')).toBeNull();
    const mac = parseDarwinDfOutput('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 1000 500 500 50% /\n', { targetFreeBytes: 0 });
    expect(mac.storage[0]).toMatchObject({ mount: '/', device: '/dev/disk3s1', totalBytes: 1024000, freeBytes: 512000 });
    expect(parseDarwinDfOutput('')).toBeNull();
    expect(parseDarwinDfOutput('one two three')).toBeNull();
    expect(parseDarwinDfOutput('fs bad used free cap /')).toBeNull();
  });

  test('collects fixed Windows and Linux commands and fails closed', async () => {
    const winRunner = { run: jest.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify({ drive: 'C:', totalBytes: 1000, freeBytes: 500 }) }) };
    const win = await collectStoragePressureSnapshot({ platform: 'win32', commandRunner: winRunner, policy: { targetFreeBytes: 0 }, now: () => NOW });
    expect(win.available).toBe(true);
    expect(winRunner.run).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-NoProfile', '-NonInteractive']), expect.objectContaining({ timeoutMs: 5000 }));
    const linuxRunner = { run: jest.fn().mockResolvedValue({ code: 0, stdout: 'fs 1000 500 500 50% /\n' }) };
    const linux = await collectStoragePressureSnapshot({ platform: 'linux', commandRunner: linuxRunner, policy: { targetFreeBytes: 0 }, now: () => NOW });
    expect(linux.available).toBe(true);
    expect(linux.pagefile).toMatchObject({ available: false, systemManaged: true, cleanup: 'never' });
    expect(linuxRunner.run).toHaveBeenCalledWith('df', ['-P', '-B1', '--', '/'], expect.any(Object));
    expect(linuxRunner.run).toHaveBeenCalledWith('free', ['-b'], expect.any(Object));
    const swapRunner = { run: jest.fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'fs 1000 500 500 50% /\n' })
      .mockResolvedValueOnce({ code: 0, stdout: '              total        used        free\nSwap:       1000         250         750\n' }) };
    const swap = await collectStoragePressureSnapshot({ platform: 'linux', commandRunner: swapRunner, policy: { targetFreeBytes: 0 }, now: () => NOW });
    expect(swap.pagefile).toMatchObject({ available: true, allocatedBytes: 1000, currentBytes: 250, pressurePercent: 25, cleanup: 'never' });
    const macRunner = { run: jest.fn().mockResolvedValue({ code: 0, stdout: 'fs 1000 500 500 50% /\n' }) };
    const mac = await collectStoragePressureSnapshot({ platform: 'darwin', commandRunner: macRunner, policy: { targetFreeBytes: 0 }, now: () => NOW });
    expect(mac).toMatchObject({ available: true, platform: 'darwin' });
    expect(mac.pagefile).toMatchObject({ available: false, systemManaged: true, cleanup: 'never' });
    expect(macRunner.run).toHaveBeenCalledWith('df', ['-Pk', '/'], expect.any(Object));
    const macSwapRunner = { run: jest.fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'fs 1000 500 500 50% /\n' })
      .mockResolvedValueOnce({ code: 0, stdout: 'total = 4096.00M used = 1024.00M free = 3072.00M (encrypted)\n' }) };
    const macSwap = await collectStoragePressureSnapshot({ platform: 'darwin', commandRunner: macSwapRunner, policy: { targetFreeBytes: 0 }, now: () => NOW });
    expect(macSwap.pagefile).toMatchObject({ available: true, allocatedBytes: 4096 * 1024 ** 2, currentBytes: 1024 * 1024 ** 2, pressurePercent: 25, cleanup: 'never' });
    expect(macSwapRunner.run).toHaveBeenCalledWith('sysctl', ['-n', 'vm.swapusage'], expect.any(Object));
    await expect(collectStoragePressureSnapshot({ platform: 'freebsd', commandRunner: macRunner, now: () => NOW })).resolves.toMatchObject({ available: false, reason: 'platform unsupported' });
    await expect(collectStoragePressureSnapshot({ platform: 'linux', now: () => NOW })).resolves.toMatchObject({ available: false, reason: 'command runner unavailable' });
    await expect(collectStoragePressureSnapshot({ platform: 'linux', commandRunner: { run: jest.fn().mockResolvedValue({ code: 1, stderr: 'denied' }) }, now: () => NOW })).resolves.toMatchObject({ available: false, reason: 'denied' });
    await expect(collectStoragePressureSnapshot({ platform: 'linux', commandRunner: { run: jest.fn().mockResolvedValue({ code: 0, stdout: 'bad' }) }, now: () => NOW })).resolves.toMatchObject({ available: false, reason: 'storage command returned invalid facts' });
    await expect(collectStoragePressureSnapshot({ platform: 'linux', commandRunner: { run: jest.fn().mockRejectedValue(new Error('missing')) }, now: () => NOW })).resolves.toMatchObject({ available: false, reason: 'missing' });
    await expect(collectStoragePressureSnapshot({ platform: 'linux', commandRunner: { run: jest.fn().mockResolvedValue({ code: 1 }) }, now: () => NOW })).resolves.toMatchObject({ available: false, reason: 'storage command failed' });
    await expect(collectStoragePressureSnapshot()).resolves.toMatchObject({ available: false, reason: 'command runner unavailable' });
    await expect(collectStoragePressureSnapshot({ platform: 'linux', now: () => NaN })).rejects.toThrow('clock');
  });
});

describe('native storage cleanup preview and execution', () => {
  let parent;
  let env;

  beforeEach(async () => {
    parent = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-pressure-'));
    env = envFor(parent);
    await fs.mkdir(env.TEMP, { recursive: true });
    await fs.mkdir(path.join(env.LOCALAPPDATA, 'npm-cache'), { recursive: true });
    await fs.mkdir(path.join(env.LOCALAPPDATA, 'D3DSCache'), { recursive: true });
    await fs.mkdir(path.join(env.LOCALAPPDATA, 'puppeteer', 'Cache'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(parent, { recursive: true, force: true });
  });

  test('previews bounded candidates, protected paths, symlinks, and category approval', async () => {
    const oldTemp = path.join(env.TEMP, 'old.tmp');
    const oldNested = path.join(env.TEMP, 'nested', 'old.log');
    const fresh = path.join(env.TEMP, 'fresh.tmp');
    const link = path.join(env.TEMP, 'link.tmp');
    const protectedDir = path.join(env.TEMP, 'protected');
    const protectedFile = path.join(protectedDir, 'secret.tmp');
    await fs.mkdir(path.dirname(oldNested), { recursive: true });
    await fs.mkdir(protectedDir);
    await Promise.all([fs.writeFile(oldTemp, '12345'), fs.writeFile(oldNested, 'nested'), fs.writeFile(fresh, 'fresh'), fs.writeFile(protectedFile, 'secret')]);
    await fs.symlink(oldTemp, link);
    await Promise.all([olden(oldTemp), olden(oldNested), olden(protectedFile), olden(fresh, NOW + 60 * 60 * 1000)]);
    const packageFile = path.join(env.LOCALAPPDATA, 'npm-cache', 'package.tgz');
    await fs.writeFile(packageFile, 'package-cache');
    await olden(packageFile);
    const preview = await previewStorageCleanup({
      platform: 'linux', env, now: () => NOW, snapshot: snapshot(),
      enabledCategories: ['temporary-files', 'package-cache'], protectedRoots: [protectedDir]
    });
    expect(preview.candidates.map((item) => item.path)).toEqual(expect.arrayContaining([oldTemp, oldNested, packageFile]));
    expect(preview.candidates.map((item) => item.path)).not.toContain(fresh);
    expect(preview.candidates.map((item) => item.path)).not.toContain(link);
    expect(preview.protectedCount).toBeGreaterThan(0);
    expect(preview.symlinkCount).toBeGreaterThan(0);
    expect(preview.categories['temporary-files']).toMatchObject({ enabled: true, eligibleBytes: 11 });
    expect(preview.plan.selected.length).toBeGreaterThan(0);
    const updateRoot = path.join(env.SystemRoot, 'SoftwareDistribution', 'Download');
    await fs.mkdir(updateRoot, { recursive: true });
    const updateFile = path.join(updateRoot, 'update.bin');
    await fs.writeFile(updateFile, 'update');
    await olden(updateFile);
    const unsafe = await previewStorageCleanup({ platform: 'win32', env, now: () => NOW, snapshot: snapshot(), enabledCategories: ['windows-update-download'] });
    expect(unsafe.categories['windows-update-download']).toMatchObject({ enabled: true, eligibleBytes: 0 });
    const approved = await previewStorageCleanup({ platform: 'win32', env, now: () => NOW, snapshot: snapshot(), enabledCategories: ['windows-update-download'], allowUnsafeCategories: true, allowAdmin: true });
    expect(approved.categories['windows-update-download'].enabled).toBe(true);
    const adminMissing = await previewStorageCleanup({ platform: 'win32', env, now: () => NOW, snapshot: snapshot(), enabledCategories: ['windows-update-download'], allowUnsafeCategories: true });
    expect(adminMissing.categories['windows-update-download'].eligibleBytes).toBe(0);
  });

  test('reports all categories without enabling them and bounds traversal', async () => {
    const abandoned = path.join(parent, 'abandoned');
    await fs.mkdir(abandoned, { recursive: true });
    const abandonedFile = path.join(abandoned, 'old.bin');
    await fs.writeFile(abandonedFile, 'abandoned');
    await olden(abandonedFile);
    const preview = await previewStorageCleanup({
      platform: 'linux', env, snapshot: snapshot({ pressure: pressure({ level: 'normal', reclaimableBytesNeeded: 0 }) }),
      enabledCategories: ['abandoned-runtime-remnants'], abandonedRuntimeRoots: [abandoned], now: () => NOW,
      policy: { targetFreeBytes: 0, maxEntries: 1, maxDepth: 0 }
    });
    expect(preview.categories['abandoned-runtime-remnants']).toMatchObject({ enabled: true, candidateCount: 1, eligibleBytes: 0 });
    expect(preview.unreadableRoots).toBeGreaterThan(0);
    expect(preview.plan.available).toBe(false);
    await expect(previewStorageCleanup({ snapshot: snapshot(), env: {}, platform: 'linux', enabledCategories: null })).resolves.toMatchObject({ candidates: [] });
    await expect(previewStorageCleanup({ snapshot: snapshot(), env, platform: 'linux', enabledCategories: ['temporary-files'], protectedRoots: [env.TEMP] })).resolves.toMatchObject({ candidates: [] });
    const originalEnv = process.env;
    process.env = {};
    try {
      await expect(previewStorageCleanup()).resolves.toMatchObject({ platform: process.platform, candidates: [] });
    } finally {
      process.env = originalEnv;
    }
    await expect(previewStorageCleanup({ snapshot: { storage: [{ totalBytes: 1000, freeBytes: 1000 }] }, env: {}, platform: 'linux', policy: { targetFreeBytes: 0 } })).resolves.toMatchObject({ pressure: expect.objectContaining({ level: 'normal' }) });
    await expect(previewStorageCleanup({ snapshot: {}, env: {}, platform: 'linux' })).resolves.toMatchObject({ pressure: expect.objectContaining({ level: 'unknown' }) });
    const raceFs = {
      readdir: jest.fn().mockResolvedValue([{ name: 'vanished' }]),
      lstat: jest.fn().mockRejectedValue(new Error('vanished'))
    };
    const racePreview = await previewStorageCleanup({
      platform: 'linux', env, fsImpl: raceFs, snapshot: snapshot(),
      enabledCategories: ['temporary-files'], now: () => NOW
    });
    expect(racePreview.raceCount).toBeGreaterThan(0);
    await expect(previewStorageCleanup({ snapshot: snapshot(), enabledCategories: ['not-a-category'] })).rejects.toThrow('Unsupported storage category');
    await expect(previewStorageCleanup({ snapshot: snapshot(), now: () => NaN })).rejects.toThrow('clock');
  });

  test('builds bounded plans only at critical or emergency pressure', () => {
    const candidates = [
      { path: '/a', root: '/root', category: 'temporary-files', sizeBytes: 4, eligible: true },
      { path: '/b', root: '/root', category: 'temporary-files', sizeBytes: 8, eligible: true },
      { path: '/c', root: '/root', category: 'temporary-files', sizeBytes: 3, eligible: false }
    ];
    expect(buildStorageCleanupPlan({ pressure: pressure({ level: 'normal', reclaimableBytesNeeded: 8 }), candidates }, { now: NOW })).toMatchObject({ available: false, estimatedBytes: 0, selected: [] });
    expect(buildStorageCleanupPlan({ pressure: pressure({ level: 'critical', reclaimableBytesNeeded: 8 }), candidates }, { now: NOW })).toMatchObject({ available: true, estimatedBytes: 8, selected: [candidates[1]] });
    expect(buildStorageCleanupPlan({ pressure: pressure({ level: 'emergency', reclaimableBytesNeeded: 20 }), candidates: [] }, { now: NOW }).reason).toContain('no-eligible');
    expect(buildStorageCleanupPlan({ pressure: { level: 'unknown' }, candidates }, { now: NOW })).toMatchObject({ requiredBytes: null, selected: [] });
    expect(buildStorageCleanupPlan()).toMatchObject({ available: false, selected: [], requiredBytes: null });
  });

  test('executes only approved files and records measured recovery', async () => {
    const root = path.join(parent, 'cleanup');
    await fs.mkdir(root);
    const remove = path.join(root, 'remove.tmp');
    const outside = path.join(parent, 'outside.tmp');
    const link = path.join(root, 'link.tmp');
    const empty = path.join(root, 'empty.tmp');
    const directory = path.join(root, 'directory');
    await fs.writeFile(remove, 'remove-me');
    await fs.writeFile(outside, 'keep-me');
    await fs.writeFile(empty, '');
    await fs.mkdir(directory);
    await fs.symlink(remove, link);
    const before = snapshot({ pressure: pressure({ freeBytes: 100 }) });
    const after = snapshot({ pressure: pressure({ freeBytes: 180 }) });
    const readSnapshot = jest.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const plan = buildStorageCleanupPlan({ pressure: pressure({ reclaimableBytesNeeded: 1 }), candidates: [{ path: remove, root, category: 'temporary-files', sizeBytes: 8, eligible: true }], protectedRoots: [] }, { now: NOW });
    await expect(executeStorageCleanupPlan(plan, { approved: false, dryRun: false })).rejects.toThrow('explicit approval');
    const dry = await executeStorageCleanupPlan(plan, { readSnapshot });
    expect(dry).toMatchObject({ dryRun: true, audit: { removedBytes: 0, spaceRecoveredBytes: 0 } });
    const result = await executeStorageCleanupPlan({ ...plan, selected: [
      ...plan.selected, { path: outside, root, category: 'temporary-files', sizeBytes: 7, eligible: true },
      { path: link, root, category: 'temporary-files', sizeBytes: 7, eligible: true },
      { path: directory, root, category: 'temporary-files', sizeBytes: 7, eligible: true },
      { path: path.join(root, 'missing'), root, category: 'temporary-files', sizeBytes: 7, eligible: true },
      { path: path.join(root, 'pagefile.sys'), root, category: 'temporary-files', sizeBytes: 7, eligible: true },
      { path: empty, root, category: 'temporary-files', sizeBytes: 0, eligible: true }
    ] }, { approved: true, dryRun: false, readSnapshot, now: () => NOW });
    expect(result).toMatchObject({ dryRun: false, audit: { removedBytes: 9, spaceRecoveredBytes: 80, recordedAt: '2030-01-02T00:00:00.000Z' } });
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: outside, reason: 'protected-or-outside-approved-root' }),
      expect.objectContaining({ path: link, reason: 'symlink' }),
      expect.objectContaining({ path: path.join(root, 'missing') })
    ]));
    await expect(fs.access(remove)).rejects.toThrow();
    await expect(fs.access(outside)).resolves.toBeUndefined();
    await expect(executeStorageCleanupPlan(null)).rejects.toThrow('valid preview plan');
    await expect(executeStorageCleanupPlan({ planVersion: 1, selected: [] }, { approved: true, dryRun: false })).resolves.toMatchObject({ audit: { spaceRecoveredBytes: null } });
    await fs.rm(outside, { force: true });
  });
});

describe('native storage pressure guard and monitor', () => {
  test('composes snapshots, previews, cleanup, and policy', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ code: 0, stdout: 'fs 1000 500 500 50% /\n' }) };
    const guard = createStoragePressureGuard({ platform: 'linux', commandRunner: runner, policy: { targetFreeBytes: 0 } });
    expect(guard.policy.targetFreeBytes).toBe(0);
    await expect(guard.snapshot()).resolves.toMatchObject({ available: true });
    await expect(guard.preview({ enabledCategories: [] })).resolves.toMatchObject({ platform: 'linux' });
    const plan = buildStorageCleanupPlan({ pressure: pressure({ level: 'normal', reclaimableBytesNeeded: 0 }), candidates: [] });
    await expect(guard.cleanup(plan)).resolves.toMatchObject({ dryRun: true });
    const monitor = guard.monitor({ intervalMs: 10, setIntervalImpl: () => 'guard-timer', clearIntervalImpl: jest.fn() });
    await expect(monitor.start()).resolves.toMatchObject({ available: true });
    monitor.stop();
    const emptyGuard = createStoragePressureGuard();
    expect(emptyGuard.policy.targetFreeBytes).toBe(DEFAULT_STORAGE_PRESSURE_POLICY.targetFreeBytes);
    const emptyGuardPreview = createStoragePressureGuard({ platform: 'linux', env: {}, commandRunner: runner, policy: { targetFreeBytes: 0 } });
    await expect(emptyGuardPreview.preview()).resolves.toMatchObject({ candidates: [] });
    await expect(emptyGuardPreview.cleanup({ planVersion: 1, selected: [] }, { protectedRoots: [] })).resolves.toMatchObject({ dryRun: true });
    emptyGuardPreview.monitor().stop();
    expect(Object.isFrozen(guard)).toBe(true);
    expect(() => createStoragePressureGuard({ policy: { maxDepth: 9 } })).toThrow('maxDepth');
  });

  test('fires monitor changes once per state and reports polling errors', async () => {
    const levels = [pressure({ level: 'warning' }), pressure({ level: 'warning' }), pressure({ level: 'critical', belowTargetFreeFloor: true })];
    const readSnapshot = jest.fn().mockImplementation(async () => snapshot({ pressure: levels.shift() || pressure({ level: 'critical' }) }));
    const onChange = jest.fn();
    const onError = jest.fn();
    let callback;
    const monitor = createStoragePressureMonitor({
      readSnapshot, intervalMs: 10, onChange, onError,
      setIntervalImpl: (fn) => { callback = fn; return 'timer'; },
      clearIntervalImpl: jest.fn()
    });
    await expect(monitor.start()).resolves.toMatchObject({ changed: true });
    await expect(monitor.poll()).resolves.toMatchObject({ changed: false });
    await expect(monitor.poll()).resolves.toMatchObject({ changed: true });
    await expect(monitor.start()).resolves.toMatchObject({ changed: false });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(typeof callback).toBe('function');
    const clear = jest.spyOn(globalThis, 'clearInterval');
    monitor.stop();
    monitor.stop();
    expect(clear).not.toHaveBeenCalled();
    clear.mockRestore();
    const clearImpl = jest.fn();
    const failing = createStoragePressureMonitor({
      readSnapshot: jest.fn().mockRejectedValue(new Error('poll failed')),
      setIntervalImpl: (fn) => { callback = fn; return 42; }, clearIntervalImpl: clearImpl, onError
    });
    await failing.start().catch(() => {});
    callback();
    await new Promise((resolve) => setImmediate(resolve));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'poll failed' }));
    failing.stop();
    failing.stop();
    expect(clearImpl).toHaveBeenCalledWith(42);
    const empty = createStoragePressureMonitor({ readSnapshot: async () => ({}), setIntervalImpl: () => null });
    await expect(empty.poll()).resolves.toMatchObject({ changed: true });
    empty.stop();
    let defaultErrorCallback;
    const defaultErrorMonitor = createStoragePressureMonitor({
      readSnapshot: jest.fn().mockRejectedValue(new Error('default poll failed')),
      setIntervalImpl: (fn) => { defaultErrorCallback = fn; return 'default-timer'; },
      clearIntervalImpl: jest.fn()
    });
    await defaultErrorMonitor.start().catch(() => {});
    defaultErrorCallback();
    await new Promise((resolve) => setImmediate(resolve));
    defaultErrorMonitor.stop();
    expect(() => createStoragePressureMonitor()).toThrow('requires readSnapshot');
    expect(() => createStoragePressureMonitor({ readSnapshot: async () => snapshot(), intervalMs: 0 })).toThrow('positive');
  });
});
