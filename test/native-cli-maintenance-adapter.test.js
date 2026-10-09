/**
 * Native CLI maintenance adapter tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  runCacheCommand,
  runDownloadCommand,
  runDownloadMonitorCommand,
  runFileInsightsCommand,
  runOrganizerCommand,
  runReportScheduleCommand,
  runProtectedRootsCommand,
  runStewardDaemonCommand,
  runStewardHistoryCommand,
  runStewardMonitorCommand,
  runStewardReportCommand,
  runStewardScheduleCommand,
  runStewardTrendsCommand,
  runStorageCommand,
  runStorageMonitorCommand
} from '../native/cli-maintenance.mjs';

function interruptOnStart(callback) {
  setImmediate(async () => {
    await callback();
    process.emit('SIGINT');
  });
}

function fakePreview() {
  return {
    eligibleBytes: 10,
    categories: { 'user-temp': { observedBytes: 10 } },
    plan: { selected: ['user-temp'] }
  };
}

describe('native CLI maintenance adapter', () => {
  let root;
  let stdout;
  let stderr;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-cli-maintenance-'));
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    stdout.mockRestore();
    stderr.mockRestore();
    await fs.rm(root, { recursive: true, force: true });
  });

  test('dispatches storage preview, cleanup, and monitor approval boundaries', async () => {
    const preview = fakePreview();
    const calls = [];
    const guard = {
      preview: async (options) => { calls.push(['preview', options]); return preview; },
      cleanup: async (...args) => { calls.push(['cleanup', ...args]); return { removed: ['safe-cache'] }; },
      monitor: (config) => ({
        async start() {
          const snapshot = { collectedAt: new Date().toISOString(), pressure: { level: 'critical', freeBytes: 1 } };
          const emergency = { collectedAt: new Date().toISOString(), pressure: { level: 'emergency', freeBytes: 1 } };
          const normal = { collectedAt: new Date().toISOString(), pressure: { level: 'normal', freeBytes: 1 } };
          await config.onSample(snapshot);
          await config.onChange(snapshot);
          await config.onChange(emergency);
          await config.onChange(normal);
          config.onError(new Error('sample failed'));
          interruptOnStart(() => Promise.resolve());
        },
        stop: () => ({ stopped: true })
      })
    };
    const growth = { observe: jest.fn(), read: jest.fn(() => ({ entries: [] })) };
    const options = { enabledCategories: ['user-temp'], allowUnsafeCategories: false, allowAdmin: false, protectedRoots: [], abandonedRuntimeRoots: [] };
    await expect(runStorageCommand('storage-preview', {}, { guard, getOptions: async () => options })).resolves.toBe(preview);
    await expect(runStorageCommand('storage-preview', { 'target-free-gb': '5' })).resolves.toMatchObject({ pressure: expect.any(Object) });
    await expect(runStorageCommand('storage-cleanup', { confirm: true }, { guard, getOptions: async () => options })).resolves.toEqual({ preview, result: { removed: ['safe-cache'] } });
    expect(calls[1][1]).toEqual(options);
    await expect(runStorageMonitorCommand({ 'auto-clean': true, enable: 'user-temp' }, { guard, growth })).resolves.toEqual({ stopped: true });
    expect(growth.observe).toHaveBeenCalled();
    expect(stdout).toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith('storage monitor: sample failed\n');
    await expect(runStorageCommand('storage-cleanup', {}, { guard, getOptions: async () => options })).rejects.toThrow('requires --confirm');
    await expect(runStorageMonitorCommand({ 'auto-clean': true })).rejects.toThrow('requires explicitly enabled categories');
    await expect(runStorageMonitorCommand({ 'auto-clean': true, enable: 'user-temp', 'allow-admin': true })).rejects.toThrow('only permits safe categories');
  });

  test('dispatches cache, organization, and file insight commands', async () => {
    const cacheRoot = path.join(root, 'cache');
    await fs.mkdir(cacheRoot);
    const source = path.join(cacheRoot, 'old.tmp');
    await fs.writeFile(source, 'cache');
    const cleaner = {
      preview: jest.fn(async () => ({ roots: [cacheRoot], items: [{ path: source, kind: 'file', sizeBytes: 5 }] })),
      clean: jest.fn(async () => ({ removed: [source] }))
    };
    await expect(runCacheCommand('cache-preview', {}, { cleaner })).resolves.toMatchObject({ items: [expect.any(Object)] });
    await expect(runCacheCommand('cache-clean', { confirm: true }, { cleaner })).resolves.toMatchObject({ result: { removed: [source] } });
    await expect(runCacheCommand('cache-clean', {}, { cleaner })).rejects.toThrow('requires --confirm');
    const quarantine = path.join(root, 'quarantine');
    await expect(runCacheCommand('cache-quarantine-preview', { 'quarantine-root': quarantine })).resolves.toMatchObject({ plan: { requiresApproval: true } });
    await expect(runCacheCommand('cache-quarantine-preview', { 'quarantine-root': quarantine, 'protected-root': path.join(root, 'protected') })).resolves.toMatchObject({ plan: { requiresApproval: true } });
    await expect(runCacheCommand('cache-quarantine-apply', { 'quarantine-root': quarantine })).rejects.toThrow('requires --confirm');
    await expect(runCacheCommand('cache-quarantine-apply', { 'quarantine-root': quarantine, confirm: true })).resolves.toMatchObject({ result: { dryRun: false } });
    const rollback = { version: 1, sourceRoots: [cacheRoot], quarantineRoot: quarantine, moved: [] };
    await expect(runCacheCommand('cache-quarantine-rollback', { result: JSON.stringify(rollback) })).resolves.toMatchObject({ mutation: 'rollback' });

    const organizeRoot = path.join(root, 'organize');
    await fs.mkdir(organizeRoot);
    await fs.writeFile(path.join(organizeRoot, 'note.txt'), 'note');
    const plan = await runOrganizerCommand('organize-preview', { root: organizeRoot, recursive: true });
    expect(plan.moves).toHaveLength(1);
    await expect(runOrganizerCommand('organize-apply', { root: organizeRoot, confirm: true })).resolves.toMatchObject({ result: { dryRun: false } });
    await expect(runOrganizerCommand('organize-apply', { root: organizeRoot })).rejects.toThrow('requires --confirm');

    await fs.writeFile(path.join(root, 'setup.exe'), 'installer');
    await expect(runFileInsightsCommand({ root, 'max-depth': '1', 'large-file-bytes': '1', 'target-root': path.join(root, 'E'), 'protected-root': root })).resolves.toMatchObject({ scan: { mutation: 'none' }, plan: { requiresApproval: true } });
    await expect(runFileInsightsCommand({ root, 'max-depth': '1' })).resolves.toMatchObject({ scan: { mutation: 'none' }, plan: { targetRoot: null } });

    const protectedStore = path.join(root, 'protected.json');
    await expect(runProtectedRootsCommand('protected-roots-read', { 'protected-store': protectedStore })).resolves.toMatchObject({ roots: [] });
    await expect(runProtectedRootsCommand('protected-roots-add', { 'protected-store': protectedStore, root: `${root}/a,${root}/b`, confirm: true })).resolves.toMatchObject({ roots: expect.arrayContaining([`${root}/a`, `${root}/b`]) });
    await expect(runProtectedRootsCommand('protected-roots-remove', { 'protected-store': protectedStore, root: `${root}/a`, confirm: true })).resolves.toMatchObject({ roots: [`${root}/b`] });
    await expect(runProtectedRootsCommand('protected-roots-remove', { 'protected-store': protectedStore, confirm: true })).resolves.toMatchObject({ roots: [`${root}/b`] });
    await expect(runProtectedRootsCommand('protected-roots-add', { 'protected-store': protectedStore })).rejects.toThrow('requires --confirm');
  });

  test('dispatches history, reports, trends, and scheduled report plans', async () => {
    const historyPath = path.join(root, 'history.jsonl');
    const entry = { id: 'entry-1', event: 'apply', timestamp: Date.now(), path: path.join(root, 'old.tmp'), reversible: true, undo: { type: 'restore' } };
    await expect(runStewardHistoryCommand({ path: historyPath })).resolves.toEqual([]);
    await expect(runStewardHistoryCommand({ path: historyPath, append: JSON.stringify(entry) })).resolves.toMatchObject({ id: 'entry-1' });
    await expect(runStewardHistoryCommand({ path: historyPath, rollback: 'entry-1' })).resolves.toMatchObject({ state: 'preview' });
    await expect(runStewardHistoryCommand({ path: historyPath, quarantine: 'entry-1', protect: path.join(root, 'protected') })).resolves.toMatchObject({ state: 'preview' });
    await expect(runStewardHistoryCommand({ path: historyPath, quarantine: 'entry-1' })).resolves.toMatchObject({ state: 'preview' });
    await expect(runStewardHistoryCommand({ path: historyPath, rollback: 'missing' })).rejects.toThrow('rollback id was not found');
    await expect(runStewardHistoryCommand({ path: historyPath, quarantine: 'missing' })).rejects.toThrow('quarantine id was not found');

    await expect(runStewardReportCommand({ path: historyPath })).resolves.toMatchObject({ window: { windowMs: 86400000 } });
    const reportPath = path.join(root, 'report.json');
    await expect(runStewardReportCommand({ path: historyPath, 'output-path': reportPath })).resolves.toMatchObject({ delivery: { state: 'delivered' } });
    await expect(runStewardTrendsCommand({ path: historyPath })).resolves.toBeDefined();

    const scheduleArgs = { path: historyPath, 'output-path': reportPath, time: '09:00' };
    await expect(runReportScheduleCommand('report-schedule-preview', { ...scheduleArgs, time: '' })).resolves.toMatchObject({ state: 'plan-ready' });
    await expect(runReportScheduleCommand('report-schedule-preview', scheduleArgs)).resolves.toMatchObject({ state: 'plan-ready' });
    await expect(runReportScheduleCommand('report-schedule-apply', scheduleArgs)).rejects.toThrow('requires --confirm');
    await expect(runReportScheduleCommand('report-schedule-apply', { ...scheduleArgs, confirm: true }, { env: { HOME: root, XDG_CONFIG_HOME: path.join(root, '.config') }, commandRunner: { run: async () => ({ code: 0, stdout: '', stderr: '' }) } })).resolves.toMatchObject({ result: { state: 'applied' } });
    await expect(runReportScheduleCommand('report-schedule-restore', { receipt: JSON.stringify({ version: 1, action: 'remove-daily-report-schedule', platform: 'freebsd', taskName: 'RNK-Optimizer-Daily-Report', details: {} }), confirm: true }, { commandRunner: { run: jest.fn() } })).resolves.toMatchObject({ state: 'rejected' });
  });

  test('runs steward monitor, scheduler, daemon, and download monitor with bounded fakes', async () => {
    const store = { append: jest.fn(async (entry) => entry), read: jest.fn(async () => []) };
    const monitorFactory = (config) => ({
      async collect() { await config.onReport({ state: 'report' }, { id: 'entry' }); },
      start() { config.onError(new Error('monitor warning')); interruptOnStart(() => Promise.resolve()); },
      stop: jest.fn()
    });
    await expect(runStewardMonitorCommand({ 'interval-seconds': '1' }, { store, monitorFactory })).resolves.toEqual({ stopped: true });
    await expect(runStewardMonitorCommand({ path: path.join(root, 'monitor.jsonl'), 'interval-seconds': '0' })).rejects.toThrow('interval out of range');

    const schedulerFactory = (config) => ({
      async run() { await config.deliver({ state: 'daily' }); },
      start() { config.onError(new Error('scheduler warning')); interruptOnStart(() => Promise.resolve()); },
      stop: jest.fn()
    });
    await expect(runStewardScheduleCommand({ path: path.join(root, 'history.jsonl'), 'interval-seconds': '1' }, { store, schedulerFactory })).resolves.toEqual({ stopped: true });
    await expect(runStewardScheduleCommand({ path: path.join(root, 'history.jsonl'), 'output-path': path.join(root, 'scheduled.json'), 'interval-seconds': '1' }, { store, schedulerFactory })).resolves.toEqual({ stopped: true });
    await expect(runStewardScheduleCommand({ path: path.join(root, 'schedule-invalid.jsonl'), 'interval-seconds': '0' })).rejects.toThrow('interval');

    const daemonFactory = (config) => ({
      async collect() { await config.onObservation({ state: 'observation' }); await config.deliver({ state: 'daily' }); },
      start() { config.onError(new Error('daemon warning')); interruptOnStart(() => Promise.resolve()); },
      stop: jest.fn()
    });
    await expect(runStewardDaemonCommand({ path: path.join(root, 'history.jsonl') }, { store, daemonFactory })).resolves.toEqual({ stopped: true });
    await expect(runStewardDaemonCommand({ path: path.join(root, 'history.jsonl'), 'report-output-path': path.join(root, 'daemon.json') }, { store, daemonFactory, adapterFactory: async () => ({}) })).resolves.toEqual({ stopped: true });
    await expect(runStewardDaemonCommand({ path: path.join(root, 'daemon-invalid.jsonl'), 'observation-interval-seconds': '0' })).rejects.toThrow('interval');

    const guard = {
      scan: jest.fn(async () => ({ root, entries: [{ path: path.join(root, 'download.part'), sizeBytes: 4, incomplete: true }] })),
      verify: jest.fn(async () => ({ verified: true })),
      preflight: jest.fn(async (value) => ({ value }))
    };
    await expect(runDownloadCommand('download-scan', { root }, { guard })).resolves.toMatchObject({ root });
    await expect(runDownloadCommand('download-verify', { file: path.join(root, 'download.part'), sha256: 'abc' }, { guard })).resolves.toEqual({ verified: true });
    await expect(runDownloadCommand('download-preflight', { 'size-bytes': '4', volumes: '[]', destination: root }, { guard })).resolves.toMatchObject({ value: { sizeBytes: 4, volumes: [] } });
    await expect(runDownloadCommand('download-preflight', {}, { guard })).resolves.toMatchObject({ value: { sizeBytes: null, volumes: [] } });
    await expect(runDownloadCommand('download-preflight', { 'size-bytes': '1' })).resolves.toBeDefined();

    const downloadMonitorFactory = (config) => ({
      async observe(target) { return config.scan(target); },
      start(target, onReport) { onReport({ root: target, state: 'active' }); interruptOnStart(() => Promise.resolve()); },
      stop: jest.fn()
    });
    await expect(runDownloadMonitorCommand({ root, 'interval-seconds': '1' }, { guard, monitorFactory: downloadMonitorFactory, storageSnapshot: async () => ({ pressure: { level: 'normal' } }), commandRunner: { run: jest.fn() } })).resolves.toEqual({ stopped: true });
    await expect(runDownloadMonitorCommand({ root, 'interval-seconds': '0' })).rejects.toThrow('interval');
    expect(stdout).toHaveBeenCalled();
  });
});
