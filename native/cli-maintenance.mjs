/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Native CLI maintenance, storage, history, and download command families.
 * Each command delegates to a bounded authority module.
 */

import { fileURLToPath } from 'url';
import { createCacheCleaner } from './cache-cleaner.js';
import { createCommandRunner } from './command-runner.js';
import { applyOrganization, previewOrganization } from './organizer.js';
import { buildFileInsightPlan, scanFileInsights } from './file-insights.js';
import { collectStoragePressureSnapshot } from './storage-pressure.js';
import { createStewardMonitor } from './steward-monitor.js';
import { createDailyWorkstationScheduler } from './steward-scheduler.js';
import { createStewardDaemon } from './steward-daemon.js';
import { createDownloadMonitor } from './download-monitor.js';
import { applyQuarantine, previewQuarantine, rollbackQuarantine } from './quarantine.js';
import { buildDailyWorkstationReport } from './workstation-report.js';
import { buildWorkstationTrends } from './workstation-trends.js';
import { createStorageGrowthTracker } from './storage-growth.js';
import { createWorkstationReportFileDelivery } from './workstation-report-delivery.js';
import { applyReportSchedule, previewReportSchedule, restoreReportSchedule } from './report-scheduler.js';
import { defaultWorkstationPaths } from './workstation-paths.js';
import {
  downloadGuardFromArgs,
  historyStoreFromArgs,
  jsonOption,
  numberOption,
  protectedRootsStoreFromArgs,
  requireOption,
  storageGuardFromArgs,
  storageOptionsFromArgs,
  storagePolicyFromArgs,
  textListOption
} from './cli-utils.mjs';

export async function runStorageCommand(command, args, { guard = storageGuardFromArgs(args), getOptions = () => storageOptionsFromArgs(args) } = {}) {
  const preview = await guard.preview(await getOptions());
  if (command === 'storage-preview') return preview;
  if (args.confirm !== true) throw new Error('storage-cleanup requires --confirm');
  return { preview, result: await guard.cleanup(preview.plan, { approved: true, dryRun: false }) };
}

export async function runStorageMonitorCommand(args, {
  guard,
  growth = createStorageGrowthTracker({
    windowMs: numberOption(args, 'growth-window-hours', 24 * 30) * 60 * 60 * 1000,
    maxEntries: numberOption(args, 'growth-max-entries', 512),
    growthThresholdBytes: numberOption(args, 'growth-threshold-bytes', 1024 ** 2)
  }),
  monitorFactory,
  commandRunner = createCommandRunner(),
  platform = process.platform,
  env = process.env,
  pathResolver = defaultWorkstationPaths
} = {}) {
  const defaults = args.packaged === true ? pathResolver({ platform, env }) : null;
  if (defaults && defaults.state !== 'ready') throw new Error(defaults.reason);
  const monitorArgs = defaults && typeof args['protected-store'] !== 'string'
    ? { ...args, 'protected-store': defaults.protectedRootsPath }
    : args;
  const effectiveGuard = guard || storageGuardFromArgs(monitorArgs, { platform, commandRunner, env });
  const effectiveMonitorFactory = monitorFactory || ((config) => effectiveGuard.monitor(config));
  const options = await storageOptionsFromArgs(monitorArgs);
  if (args['auto-clean'] === true && options.enabledCategories.length === 0) {
    throw new Error('storage-monitor --auto-clean requires explicitly enabled categories');
  }
  if (args['auto-clean'] === true && (options.allowUnsafeCategories || options.allowAdmin)) {
    throw new Error('storage-monitor --auto-clean only permits safe categories');
  }
  const monitor = effectiveMonitorFactory({
    intervalMs: numberOption(args, 'interval-seconds', 60) * 1000,
    onSample: async (snapshot) => {
      const preview = await effectiveGuard.preview({ ...options, snapshot });
      growth.observe({
        timestamp: Date.parse(snapshot.collectedAt),
        freeBytes: snapshot.pressure?.freeBytes,
        reclaimableBytes: preview.eligibleBytes,
        categories: Object.fromEntries(Object.entries(preview.categories).map(([category, item]) => [category, item.observedBytes]))
      });
    },
    onChange: async (snapshot) => {
      const preview = await effectiveGuard.preview({ ...options, snapshot });
      const result = args['auto-clean'] === true
        && (snapshot.pressure?.level === 'critical' || snapshot.pressure?.level === 'emergency')
        && preview.plan.selected.length > 0
        ? await effectiveGuard.cleanup(preview.plan, { approved: true, dryRun: false })
        : null;
      process.stdout.write(`${JSON.stringify({ snapshot, preview, growth: growth.read(), result })}\n`);
    },
    onError: (error) => process.stderr.write(`storage monitor: ${error.message}\n`)
  });
  await monitor.start();
  await new Promise((resolve) => {
    const stop = () => { monitor.stop(); resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return { stopped: true };
}

export async function runProtectedRootsCommand(command, args) {
  const store = protectedRootsStoreFromArgs(args);
  if (command === 'protected-roots-read') return store.read();
  if (args.confirm !== true) throw new Error(`${command} requires --confirm`);
  const roots = typeof args.root === 'string' ? args.root.split(',').map((value) => value.trim()).filter(Boolean) : [];
  return command === 'protected-roots-add' ? store.add(roots) : store.remove(roots);
}

export async function runCacheCommand(command, args, { cleaner = createCacheCleaner() } = {}) {
  if (command === 'cache-quarantine-rollback') return rollbackQuarantine(jsonOption(args, 'result'));
  const preview = await cleaner.preview({
    target: args.target || 'user-temp',
    maxAgeHours: numberOption(args, 'max-age-hours', 24),
    maxEntries: numberOption(args, 'max-entries', 2000)
  });
  if (command === 'cache-preview') return preview;
  if (command === 'cache-quarantine-preview' || command === 'cache-quarantine-apply') {
    const plan = previewQuarantine(preview.items, {
      sourceRoots: preview.roots,
      quarantineRoot: requireOption(args, 'quarantine-root'),
      protectedRoots: typeof args['protected-root'] === 'string' ? args['protected-root'].split(',').filter(Boolean) : [],
      maxEntries: numberOption(args, 'max-entries', 256)
    });
    if (command === 'cache-quarantine-preview') return { preview, plan };
    if (args.confirm !== true) throw new Error('cache-quarantine-apply requires --confirm');
    return { preview, plan, result: await applyQuarantine(plan, { approved: true, dryRun: false }) };
  }
  if (args.confirm !== true) throw new Error('cache-clean requires --confirm');
  return { preview, result: await cleaner.clean(preview, { approved: true, dryRun: false }) };
}

export async function runOrganizerCommand(command, args) {
  const root = requireOption(args, 'root');
  const protectedRoots = textListOption(args, 'protected-root');
  const plan = await previewOrganization(root, { recursive: args.recursive === true, maxEntries: numberOption(args, 'max-entries', 1000), protectedRoots });
  if (command === 'organize-preview') return plan;
  if (args.confirm !== true) throw new Error('organize-apply requires --confirm');
  return { plan, result: await applyOrganization(plan, { approved: true, dryRun: false, protectedRoots }) };
}

export async function runFileInsightsCommand(args) {
  const scan = await scanFileInsights(requireOption(args, 'root'), {
    maxEntries: numberOption(args, 'max-entries', 2000),
    maxDepth: numberOption(args, 'max-depth', 4),
    minAgeHours: numberOption(args, 'min-age-hours', 24 * 30),
    largeFileBytes: numberOption(args, 'large-file-bytes', 1024 ** 3),
    protectedRoots: typeof args['protected-root'] === 'string' ? args['protected-root'].split(',').filter(Boolean) : [],
    hashFiles: args['hash-files'] === true
  });
  return { scan, plan: buildFileInsightPlan(scan, { targetRoot: args['target-root'] || null }) };
}

export async function runStewardHistoryCommand(args) {
  const store = historyStoreFromArgs(args);
  if (typeof args.append === 'string') return store.append(JSON.parse(args.append));
  if (typeof args.rollback === 'string') {
    const entry = (await store.read()).find((item) => item.id === args.rollback);
    if (!entry) throw new Error('steward-history rollback id was not found');
    return store.rollbackPlan(entry);
  }
  if (typeof args.quarantine === 'string') {
    const entry = (await store.read()).find((item) => item.id === args.quarantine);
    if (!entry) throw new Error('steward-history quarantine id was not found');
    return store.quarantinePlan(entry, args.protect ? [args.protect] : []);
  }
  return store.read();
}

export async function runStewardMonitorCommand(args, {
  store = historyStoreFromArgs(args),
  monitorFactory = createStewardMonitor,
  adapterFactory = async () => (await import('./platform.js')).createPlatformAdapter()
} = {}) {
  const monitor = monitorFactory({
    adapter: await adapterFactory(),
    store,
    intervalMs: numberOption(args, 'interval-seconds', 900) * 1000,
    onReport: (report) => process.stdout.write(`${JSON.stringify(report)}\n`),
    onError: (error) => process.stderr.write(`steward monitor: ${error.message}\n`)
  });
  await monitor.collect();
  monitor.start();
  await new Promise((resolve) => {
    const stop = () => { monitor.stop(); resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return { stopped: true };
}

export async function runStewardReportCommand(args) {
  const store = historyStoreFromArgs(args);
  const report = buildDailyWorkstationReport(await store.read(), {
    windowMs: numberOption(args, 'window-hours', 24) * 60 * 60 * 1000,
    maxSamples: numberOption(args, 'max-samples', 96)
  });
  if (typeof args['output-path'] !== 'string') return report;
  const delivery = createWorkstationReportFileDelivery({ filePath: args['output-path'], format: args.format || 'json' });
  return { report, delivery: await delivery.deliver(report) };
}

export async function runStewardSnapshotCommand(args, {
  adapter,
  store = historyStoreFromArgs(args),
  monitorFactory = createStewardMonitor,
  adapterFactory = async () => (await import('./platform.js')).createPlatformAdapter()
} = {}) {
  const monitor = monitorFactory({
    adapter: adapter || await adapterFactory(),
    store,
    intervalMs: 86400000,
    onReport: () => {},
    onError: () => {}
  });
  const { report, entry } = await monitor.collect();
  if (typeof args['output-path'] !== 'string') return { report, entry };
  const delivery = createWorkstationReportFileDelivery({ filePath: args['output-path'], format: args.format || 'json' });
  return { report, entry, delivery: await delivery.deliver(report) };
}

export async function runReportScheduleCommand(command, args, { commandRunner = createCommandRunner(), env = process.env, platform = process.platform, pathResolver = defaultWorkstationPaths } = {}) {
  if (command === 'report-schedule-restore') {
    return restoreReportSchedule(jsonOption(args, 'receipt'), {
      approved: true,
      dryRun: args.confirm !== true,
      commandRunner
    });
  }
  const defaults = args.packaged === true ? pathResolver({ platform, env }) : null;
  if (defaults && defaults.state !== 'ready') throw new Error(defaults.reason);
  const plan = previewReportSchedule({
    platform,
    nodePath: process.execPath,
    cliPath: fileURLToPath(new URL('./cli.mjs', import.meta.url)),
    historyPath: defaults?.historyPath || requireOption(args, 'path'),
    outputPath: defaults?.reportPath || requireOption(args, 'output-path'),
    format: args.format || (defaults ? 'html' : 'json'),
    time: args.time || '09:00',
    taskName: args['task-name'] || undefined,
    env
  });
  if (command === 'report-schedule-preview') return plan;
  if (args.confirm !== true) throw new Error('report-schedule-apply requires --confirm');
  return { plan, result: await applyReportSchedule(plan, { approved: true, dryRun: false, commandRunner }) };
}

export async function runStewardTrendsCommand(args) {
  const store = historyStoreFromArgs(args);
  return buildWorkstationTrends(await store.read(), { windowMs: numberOption(args, 'window-days', 30) * 24 * 60 * 60 * 1000, maxEntries: numberOption(args, 'max-entries', 512) });
}

export async function runStewardScheduleCommand(args, { store = historyStoreFromArgs(args), schedulerFactory = createDailyWorkstationScheduler } = {}) {
  const deliver = typeof args['output-path'] === 'string'
    ? createWorkstationReportFileDelivery({ filePath: args['output-path'], format: args.format || 'json' }).deliver
    : (report) => process.stdout.write(`${JSON.stringify(report)}\n`);
  const scheduler = schedulerFactory({
    store,
    intervalMs: numberOption(args, 'interval-seconds', 900) * 1000,
    windowMs: numberOption(args, 'window-hours', 24) * 60 * 60 * 1000,
    maxSamples: numberOption(args, 'max-samples', 96),
    deliver,
    onError: (error) => process.stderr.write(`steward scheduler: ${error.message}\n`)
  });
  await scheduler.run();
  scheduler.start();
  await new Promise((resolve) => {
    const stop = () => { scheduler.stop(); resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return { stopped: true };
}

export async function runStewardDaemonCommand(args, {
  store = null,
  daemonFactory = createStewardDaemon,
  adapterFactory = async () => (await import('./platform.js')).createPlatformAdapter(),
  platform = process.platform,
  env = process.env,
  pathResolver = defaultWorkstationPaths
} = {}) {
  const defaults = args.packaged === true ? pathResolver({ platform, env }) : null;
  if (defaults && defaults.state !== 'ready') throw new Error(defaults.reason);
  const historyPath = defaults?.historyPath || requireOption(args, 'path');
  const reportPath = defaults?.reportPath || args['report-output-path'];
  const reportFormat = args.format || (defaults ? 'html' : 'json');
  const history = store || historyStoreFromArgs({ ...args, path: historyPath });
  const reportDelivery = typeof reportPath === 'string'
    ? createWorkstationReportFileDelivery({ filePath: reportPath, format: reportFormat })
    : null;
  const daemon = daemonFactory({
    adapter: await adapterFactory(),
    store: history,
    observationIntervalMs: numberOption(args, 'observation-interval-seconds', 900) * 1000,
    reportIntervalMs: numberOption(args, 'report-interval-seconds', 900) * 1000,
    onObservation: (report) => process.stdout.write(`${JSON.stringify({ type: 'observation', report })}\n`),
    deliver: (report) => reportDelivery
      ? reportDelivery.deliver(report)
      : process.stdout.write(`${JSON.stringify({ type: 'daily-report', report })}\n`),
    onError: (error) => process.stderr.write(`steward daemon: ${error.message}\n`)
  });
  await daemon.collect({ forceReport: args['force-report'] === true });
  daemon.start();
  await new Promise((resolve) => {
    const stop = () => { daemon.stop(); resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return { stopped: true };
}

export async function runDownloadCommand(command, args, { guard = downloadGuardFromArgs(args) } = {}) {
  if (command === 'download-scan') return guard.scan(requireOption(args, 'root'), { hashFiles: args['hash-files'] === true });
  if (command === 'download-verify') return guard.verify(requireOption(args, 'file'), requireOption(args, 'sha256'));
  let volumes = [];
  if (typeof args.volumes === 'string') volumes = JSON.parse(args.volumes);
  return guard.preflight({ sizeBytes: numberOption(args, 'size-bytes', null), destinationMount: args.destination || null, volumes });
}

export async function runDownloadMonitorCommand(args, {
  guard = downloadGuardFromArgs(args),
  monitorFactory = createDownloadMonitor,
  storageSnapshot = collectStoragePressureSnapshot,
  commandRunner = createCommandRunner()
} = {}) {
  const root = requireOption(args, 'root');
  const policy = storagePolicyFromArgs(args);
  const monitor = monitorFactory({
    scan: async (target) => {
      const download = await guard.scan(target, { hashFiles: false });
      const storage = await storageSnapshot({ platform: process.platform, commandRunner, policy });
      return { ...download, storage: storage.pressure };
    },
    intervalMs: numberOption(args, 'interval-seconds', 30) * 1000
  });
  process.stdout.write(`${JSON.stringify(await monitor.observe(root))}\n`);
  monitor.start(root, (report) => process.stdout.write(`${JSON.stringify(report)}\n`));
  await new Promise((resolve) => {
    const stop = () => { monitor.stop(); resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return { stopped: true };
}
