#!/usr/bin/env node
/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/gpl-3.0.html>.
 *
 * Explicit native-agent entry point. Optimization previews by default;
 * operating-system changes require --apply and destructive approvals.
 */

import { pathToFileURL } from 'url';
import { createCacheCleaner } from './cache-cleaner.js';
import { createCommandRunner } from './command-runner.js';
import { NativeOptimizerAgent } from './agent.js';
import { createPlatformAdapter } from './platform.js';
import { applyOrganization, previewOrganization } from './organizer.js';
import { buildFileInsightPlan, scanFileInsights } from './file-insights.js';
import { createStoragePressureGuard } from './storage-pressure.js';
import { createStewardHistoryStore } from './steward-history.js';
import { createStewardMonitor } from './steward-monitor.js';
import { createDailyWorkstationScheduler } from './steward-scheduler.js';
import { createStewardDaemon } from './steward-daemon.js';
import { createDownloadGuard } from './download-guard.js';
import { createDownloadMonitor } from './download-monitor.js';
import { createAuditedNativeAgent } from './action-audit.js';
import { createMediaLibrary, scanMediaRoot } from './media-library.js';
import { buildMediaPanelPlan, createMediaPlayer } from './media-player.js';
import { applyMediaPlayback, buildMediaPlaybackPlan } from './media-playback.js';
import { applyMediaPanelOpen, buildMediaPanelOpenPlan } from './media-panel.js';
import { collectMediaMetadata } from './media-metadata.js';
import { buildDailyWorkstationReport } from './workstation-report.js';
import { buildWorkstationTrends } from './workstation-trends.js';
import { applyWorkloadPolicy, previewWorkloadPolicy } from './workload-governor.js';
import { applyWorkloadBudget, previewWorkloadBudget } from './workload-budget.js';
import { applyResourceLimits, previewResourceLimits } from './resource-limits.js';
import { createGameSessionMonitor } from './game-session.js';
import { collectDriveHealth, collectSmartHealth } from './drive-health.js';
import { collectFilesystemHealth } from './filesystem-health.js';
import { benchmarkDrive } from './drive-benchmark.js';
import { buildNetworkContentionPlan } from './network-manager.js';
import { createNetworkRateMonitor } from './network-rate.js';
import { applyFilePlacement, previewFilePlacement, rollbackFilePlacement } from './file-placement.js';
import { applyPlacementPolicy, previewPlacementPolicy, rollbackPlacementPolicy } from './file-placement-policy.js';
import { applyQuarantine, previewQuarantine, rollbackQuarantine } from './quarantine.js';
import { interpretWorkstationQuestion } from './workstation-assistant.js';
import { applyPowerProfile, previewPowerProfile, recommendPowerProfile } from './power-manager.js';
import { createPowerMonitor } from './power-monitor.js';
import { applyProcessStop, buildProcessOverview, previewProcessStop } from './process-manager.js';
import { applyStartupMutation, previewStartupMutation, restoreStartupMutation } from './startup-manager.js';

function parseValue(raw) {
  const equals = raw.indexOf('=');
  return equals === -1 ? null : raw.slice(equals + 1);
}

export function parseArgs(argv = []) {
  const values = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) {
      values._.push(raw);
      continue;
    }
    const key = raw.slice(2).split('=')[0];
    const inline = parseValue(raw);
    if (!key) throw new Error('Invalid empty option');
    if (inline !== null) values[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) values[key] = argv[++index];
    else values[key] = true;
  }
  return values;
}

function numberOption(args, name, fallback) {
  if (args[name] === undefined) return fallback;
  const value = Number(args[name]);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be numeric`);
  return value;
}

function approvals(value) {
  if (value === true) return true;
  if (typeof value !== 'string' || value.length === 0) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function requireOption(args, name) {
  if (typeof args[name] !== 'string' || args[name].length === 0) throw new Error(`--${name} is required`);
  return args[name];
}

function historyStoreFromArgs(args) {
  return createStewardHistoryStore({ filePath: requireOption(args, 'path'), maxEntries: numberOption(args, 'max-entries', 2048) });
}

function storagePolicyFromArgs(args) {
  return {
    warningPercent: numberOption(args, 'warning-percent', 20),
    criticalPercent: numberOption(args, 'critical-percent', 10),
    emergencyPercent: numberOption(args, 'emergency-percent', 5),
    targetFreeBytes: numberOption(args, 'target-free-gb', 5) * 1024 ** 3,
    minAgeHours: numberOption(args, 'min-age-hours', 24),
    maxEntries: numberOption(args, 'max-entries', 2000)
  };
}

function storageGuardFromArgs(args) {
  return createStoragePressureGuard({
    platform: process.platform,
    commandRunner: createCommandRunner(),
    env: process.env,
    policy: storagePolicyFromArgs(args)
  });
}

function storageOptionsFromArgs(args) {
  return {
    enabledCategories: approvals(args.enable),
    allowUnsafeCategories: args['allow-unsafe'] === true,
    allowAdmin: args['allow-admin'] === true,
    abandonedRuntimeRoots: args['abandoned-root'] ? [args['abandoned-root']] : []
  };
}

async function runStorageCommand(command, args) {
  const guard = storageGuardFromArgs(args);
  const preview = await guard.preview(storageOptionsFromArgs(args));
  if (command === 'storage-preview') return preview;
  if (args.confirm !== true) throw new Error('storage-cleanup requires --confirm');
  return { preview, result: await guard.cleanup(preview.plan, { approved: true, dryRun: false }) };
}

async function runStorageMonitorCommand(args) {
  const guard = storageGuardFromArgs(args);
  const options = storageOptionsFromArgs(args);
  if (args['auto-clean'] === true && options.enabledCategories.length === 0) {
    throw new Error('storage-monitor --auto-clean requires explicitly enabled categories');
  }
  if (args['auto-clean'] === true && (options.allowUnsafeCategories || options.allowAdmin)) {
    throw new Error('storage-monitor --auto-clean only permits safe categories');
  }
  const monitor = guard.monitor({
    intervalMs: numberOption(args, 'interval-seconds', 60) * 1000,
    onChange: async (snapshot) => {
      const preview = await guard.preview({ ...options, snapshot });
      const result = args['auto-clean'] === true
        && (snapshot.pressure?.level === 'critical' || snapshot.pressure?.level === 'emergency')
        && preview.plan.selected.length > 0
        ? await guard.cleanup(preview.plan, { approved: true, dryRun: false })
        : null;
      process.stdout.write(`${JSON.stringify({ snapshot, preview, result })}\n`);
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

function agentFromArgs(args) {
  const adapter = createPlatformAdapter();
  return new NativeOptimizerAgent({
    adapter,
    gatewayUrl: args.gateway || process.env.OPTIMIZER_GATEWAY_URL || '',
    gatewayToken: args.token || process.env.OPTIMIZER_GATEWAY_TOKEN || '',
    clientId: args.client || process.env.OPTIMIZER_CLIENT_ID || 'native-local',
    profile: args.profile || process.env.OPTIMIZER_PROFILE || 'balanced',
    targetPid: args['target-pid'] === undefined ? null : numberOption(args, 'target-pid', null)
  });
}

async function runCacheCommand(command, args) {
  if (command === 'cache-quarantine-rollback') return rollbackQuarantine(jsonOption(args, 'result'));
  const cleaner = createCacheCleaner();
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

async function runOrganizerCommand(command, args) {
  const root = requireOption(args, 'root');
  const plan = await previewOrganization(root, { recursive: args.recursive === true, maxEntries: numberOption(args, 'max-entries', 1000) });
  if (command === 'organize-preview') return plan;
  if (args.confirm !== true) throw new Error('organize-apply requires --confirm');
  return { plan, result: await applyOrganization(plan, { approved: true, dryRun: false }) };
}

async function runFileInsightsCommand(args) {
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

async function runStewardHistoryCommand(args) {
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

async function runStewardMonitorCommand(args) {
  const store = historyStoreFromArgs(args);
  const monitor = createStewardMonitor({
    adapter: createPlatformAdapter(),
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

async function runStewardReportCommand(args) {
  const store = historyStoreFromArgs(args);
  return buildDailyWorkstationReport(await store.read(), {
    windowMs: numberOption(args, 'window-hours', 24) * 60 * 60 * 1000,
    maxSamples: numberOption(args, 'max-samples', 96)
  });
}

async function runStewardTrendsCommand(args) {
  const store = historyStoreFromArgs(args);
  return buildWorkstationTrends(await store.read(), { windowMs: numberOption(args, 'window-days', 30) * 24 * 60 * 60 * 1000, maxEntries: numberOption(args, 'max-entries', 512) });
}

async function runStewardScheduleCommand(args) {
  const store = historyStoreFromArgs(args);
  const scheduler = createDailyWorkstationScheduler({
    store,
    intervalMs: numberOption(args, 'interval-seconds', 900) * 1000,
    windowMs: numberOption(args, 'window-hours', 24) * 60 * 60 * 1000,
    maxSamples: numberOption(args, 'max-samples', 96),
    deliver: (report) => process.stdout.write(`${JSON.stringify(report)}\n`),
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

async function runStewardDaemonCommand(args) {
  const store = historyStoreFromArgs(args);
  const daemon = createStewardDaemon({
    adapter: createPlatformAdapter(),
    store,
    observationIntervalMs: numberOption(args, 'observation-interval-seconds', 900) * 1000,
    reportIntervalMs: numberOption(args, 'report-interval-seconds', 900) * 1000,
    onObservation: (report) => process.stdout.write(`${JSON.stringify({ type: 'observation', report })}\n`),
    deliver: (report) => process.stdout.write(`${JSON.stringify({ type: 'daily-report', report })}\n`),
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

function downloadGuardFromArgs(args) {
  return createDownloadGuard({ hashFiles: args['hash-files'] === true });
}

function listOption(args, name) {
  if (args[name] === undefined) return [];
  if (typeof args[name] !== 'string') throw new Error(`--${name} must be a comma-separated list`);
  const values = args[name].split(',').map((value) => Number(value.trim()));
  if (values.some((value) => !Number.isInteger(value) || value < 1)) throw new Error(`--${name} contains an invalid PID`);
  return [...new Set(values)];
}

async function runWorkloadCommand(command, args) {
  const adapter = createPlatformAdapter();
  const facts = await adapter.collectFacts();
  const plan = previewWorkloadPolicy(facts, {
    mode: args.mode || 'balanced',
    gameNames: typeof args['game-names'] === 'string' ? args['game-names'].split(',').map((value) => value.trim()).filter(Boolean) : [],
    backgroundPids: listOption(args, 'background-pids'),
    processPriority: args['process-priority'] || 'low',
    ioPriority: args['io-priority'] || 'low'
  });
  if (command === 'workload-preview') return { facts, plan };
  if (args.confirm !== true) throw new Error('workload-apply requires --confirm');
  const approvedPids = listOption(args, 'approve-pids');
  if (approvedPids.length === 0) throw new Error('workload-apply requires --approve-pids');
  return { facts, plan, report: await applyWorkloadPolicy(plan, { adapter, approvedPids, allowAdmin: args['allow-admin'] === true, dryRun: false }) };
}

async function runWorkloadBudgetCommand(command, args) {
  const adapter = createPlatformAdapter();
  const facts = await adapter.collectFacts();
  const budget = typeof args.budget === 'string' ? jsonOption(args, 'budget') : {
    cpuPercent: args['cpu-percent'] === undefined ? null : numberOption(args, 'cpu-percent', null),
    memoryBytes: args['memory-bytes'] === undefined ? null : numberOption(args, 'memory-bytes', null),
    ioBytesPerSecond: args['io-bytes-per-second'] === undefined ? null : numberOption(args, 'io-bytes-per-second', null),
    gpuPercent: args['gpu-percent'] === undefined ? null : numberOption(args, 'gpu-percent', null)
  };
  const plan = previewWorkloadBudget(facts, { budget, targetPids: listOption(args, 'target-pids') });
  if (command === 'workload-budget-preview') return { facts, plan };
  if (args.confirm !== true) throw new Error('workload-budget-apply requires --confirm');
  const approvedPids = listOption(args, 'approve-pids');
  if (approvedPids.length === 0) throw new Error('workload-budget-apply requires --approve-pids');
  return { facts, plan, report: await applyWorkloadBudget(plan, { adapter, approvedPids, allowAdmin: args['allow-admin'] === true, dryRun: false }) };
}

async function runResourceLimitCommand(command, args) {
  const adapter = createPlatformAdapter();
  const facts = await adapter.collectFacts();
  const limits = typeof args.limits === 'string' ? jsonOption(args, 'limits') : {
    cpuPercent: args['cpu-percent'] === undefined ? null : numberOption(args, 'cpu-percent', null),
    memoryBytes: args['memory-bytes'] === undefined ? null : numberOption(args, 'memory-bytes', null)
  };
  const plan = previewResourceLimits(facts, { limits, targetPids: listOption(args, 'target-pids') });
  if (command === 'resource-limit-preview') return { facts, plan };
  if (args.confirm !== true) throw new Error('resource-limit-apply requires --confirm');
  const approvedPids = listOption(args, 'approve-pids');
  if (approvedPids.length === 0) throw new Error('resource-limit-apply requires --approve-pids');
  return { facts, plan, report: await applyResourceLimits(plan, { adapter, approvedPids, allowAdmin: args['allow-admin'] === true, dryRun: false }) };
}

async function runGameSessionCommand(args) {
  const autoApply = args['auto-apply'] === true;
  if (autoApply && args.confirm !== true) throw new Error('game-session-monitor --auto-apply requires --confirm');
  const approvedPids = listOption(args, 'approve-pids');
  if (autoApply && approvedPids.length === 0) throw new Error('game-session-monitor --auto-apply requires --approve-pids');
  const monitor = createGameSessionMonitor({
    adapter: createPlatformAdapter(),
    gameNames: typeof args['game-names'] === 'string' ? args['game-names'].split(',').map((value) => value.trim()).filter(Boolean) : [],
    backgroundPids: listOption(args, 'background-pids'),
    processPriority: args['process-priority'] || 'low',
    ioPriority: args['io-priority'] || 'low',
    intervalMs: numberOption(args, 'interval-seconds', 10) * 1000,
    autoApply,
    approvedPids,
    allowAdmin: args['allow-admin'] === true,
    onEvent: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
    onError: (error) => process.stderr.write(`game session: ${error.message}\n`)
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

async function runDriveHealthCommand(args) {
  const inventory = await collectDriveHealth({ platform: process.platform, commandRunner: createCommandRunner() });
  if (typeof args['smart-device'] !== 'string') return inventory;
  return { inventory, smart: await collectSmartHealth(args['smart-device'], { platform: process.platform, commandRunner: createCommandRunner() }) };
}

async function runFilesystemHealthCommand(args) {
  return collectFilesystemHealth(requireOption(args, 'root'), { platform: process.platform, commandRunner: createCommandRunner() });
}

async function runDriveBenchmarkCommand(args) {
  return benchmarkDrive({ root: requireOption(args, 'root'), bytes: numberOption(args, 'bytes', 1024 * 1024) });
}

async function runNetworkOverviewCommand(args) {
  const facts = await createPlatformAdapter().collectFacts();
  const samples = typeof args.samples === 'string' ? jsonOption(args, 'samples') : [];
  return { facts, plan: buildNetworkContentionPlan({ samples, gamePid: args['game-pid'] === undefined ? null : numberOption(args, 'game-pid', null), latencyMs: args['latency-ms'] === undefined ? null : numberOption(args, 'latency-ms', null) }) };
}

async function runNetworkRateMonitorCommand(args) {
  const monitor = createNetworkRateMonitor({
    collectSample: async () => (await createPlatformAdapter().collectFacts()).network,
    intervalMs: numberOption(args, 'interval-seconds', 5) * 1000,
    onReport: (report) => process.stdout.write(`${JSON.stringify(report)}\n`),
    onError: (error) => process.stderr.write(`network rate monitor: ${error.message}\n`)
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

function jsonOption(args, name) {
  try { return JSON.parse(requireOption(args, name)); } catch (error) { throw new Error(`--${name} must contain valid JSON: ${error.message}`); }
}

async function runPlacementCommand(command, args) {
  if (command === 'placement-rollback') return rollbackFilePlacement(jsonOption(args, 'result'));
  const plan = previewFilePlacement({
    files: jsonOption(args, 'files'),
    sourceRoots: [requireOption(args, 'source-root')],
    targetRoot: requireOption(args, 'target-root'),
    protectedRoots: typeof args['protected-root'] === 'string' ? args['protected-root'].split(',').filter(Boolean) : [],
    targetFreeBytes: numberOption(args, 'target-free-bytes', null),
    maxEntries: numberOption(args, 'max-entries', 256)
  });
  if (command === 'placement-preview') return plan;
  if (args.confirm !== true) throw new Error('placement-apply requires --confirm');
  return { plan, result: await applyFilePlacement(plan, { approved: true, dryRun: false }) };
}

async function runPlacementPolicyCommand(command, args) {
  if (command === 'placement-policy-rollback') return rollbackPlacementPolicy(jsonOption(args, 'result'));
  const plan = previewPlacementPolicy(jsonOption(args, 'scan'), {
    targetRoots: jsonOption(args, 'target-roots'),
    sourceRoots: typeof args['source-root'] === 'string' ? args['source-root'].split(',').filter(Boolean) : undefined,
    protectedRoots: typeof args['protected-root'] === 'string' ? args['protected-root'].split(',').filter(Boolean) : [],
    targetFreeBytes: typeof args['target-free-bytes'] === 'string' ? jsonOption(args, 'target-free-bytes') : {},
    maxEntries: numberOption(args, 'max-entries', 256)
  });
  if (command === 'placement-policy-preview') return plan;
  if (args.confirm !== true) throw new Error('placement-policy-apply requires --confirm');
  return { plan, result: await applyPlacementPolicy(plan, { approved: true, dryRun: false }) };
}

async function runAssistantCommand(args) {
  const facts = typeof args.facts === 'string' ? jsonOption(args, 'facts') : await createPlatformAdapter().collectFacts();
  const report = typeof args.report === 'string' ? jsonOption(args, 'report') : null;
  return interpretWorkstationQuestion(requireOption(args, 'question'), facts, { report });
}

async function runPowerCommand(command, args) {
  const adapter = createPlatformAdapter();
  const facts = await adapter.collectFacts();
  if (command === 'power-recommend') return { facts, recommendation: recommendPowerProfile(facts) };
  const profile = requireOption(args, 'profile');
  const plan = previewPowerProfile(profile, { platform: process.platform, facts });
  if (command === 'power-preview') return { facts, plan };
  if (args.confirm !== true) throw new Error('power-apply requires --confirm');
  return { facts, plan, result: await applyPowerProfile(plan, { adapter, approved: true, allowAdmin: args['allow-admin'] === true, dryRun: false }) };
}

async function runPowerMonitorCommand(args) {
  const autoApply = args['auto-apply'] === true;
  if (autoApply && args.confirm !== true) throw new Error('power-monitor --auto-apply requires --confirm');
  const monitor = createPowerMonitor({
    adapter: createPlatformAdapter(),
    platform: process.platform,
    intervalMs: numberOption(args, 'interval-seconds', 300) * 1000,
    autoApply,
    approved: args.confirm === true,
    allowAdmin: args['allow-admin'] === true,
    onReport: (report) => process.stdout.write(`${JSON.stringify(report)}\n`),
    onError: (error) => process.stderr.write(`power monitor: ${error.message}\n`)
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

async function runProcessCommand(command, args) {
  const adapter = createPlatformAdapter();
  const facts = await adapter.collectFacts();
  const protectedNames = typeof args['protected-name'] === 'string' ? args['protected-name'].split(',').filter(Boolean) : [];
  if (command === 'process-overview') return { facts, overview: buildProcessOverview(facts, { protectedNames, maxEntries: numberOption(args, 'max-entries', 128) }) };
  const plan = previewProcessStop(facts, numberOption(args, 'pid', null), { protectedNames });
  if (command === 'process-stop-preview') return { facts, plan };
  if (args.confirm !== true) throw new Error('process-stop-apply requires --confirm');
  return { facts, plan, result: await applyProcessStop(plan, { adapter, approved: true, allowAdmin: args['allow-admin'] === true, dryRun: false }) };
}

async function runStartupCommand(command, args) {
  const adapter = createPlatformAdapter();
  if (command === 'startup-restore') {
    const receipt = jsonOption(args, 'receipt');
    return restoreStartupMutation(receipt, { approved: true, allowAdmin: args['allow-admin'] === true, dryRun: args.confirm !== true, commandRunner: createCommandRunner() });
  }
  const facts = typeof args.facts === 'string' ? jsonOption(args, 'facts') : await adapter.collectFacts();
  const plan = previewStartupMutation(facts, { name: requireOption(args, 'name'), location: requireOption(args, 'location'), protectedNames: typeof args['protected-name'] === 'string' ? args['protected-name'].split(',').filter(Boolean) : [] });
  if (command === 'startup-preview') return { facts, plan };
  if (args.confirm !== true) throw new Error('startup-apply requires --confirm');
  return { facts, plan, result: await applyStartupMutation(plan, { approved: true, allowAdmin: args['allow-admin'] === true, dryRun: false, commandRunner: createCommandRunner() }) };
}

async function runDownloadCommand(command, args) {
  const guard = downloadGuardFromArgs(args);
  if (command === 'download-scan') return guard.scan(requireOption(args, 'root'), { hashFiles: args['hash-files'] === true });
  if (command === 'download-verify') return guard.verify(requireOption(args, 'file'), requireOption(args, 'sha256'));
  let volumes = [];
  if (typeof args.volumes === 'string') volumes = JSON.parse(args.volumes);
  return guard.preflight({ sizeBytes: numberOption(args, 'size-bytes', null), destinationMount: args.destination || null, volumes });
}

async function runDownloadMonitorCommand(args) {
  const guard = downloadGuardFromArgs(args);
  const root = requireOption(args, 'root');
  const monitor = createDownloadMonitor({ scan: (target) => guard.scan(target, { hashFiles: false }), intervalMs: numberOption(args, 'interval-seconds', 30) * 1000 });
  process.stdout.write(`${JSON.stringify(await monitor.observe(root))}\n`);
  monitor.start(root, (report) => process.stdout.write(`${JSON.stringify(report)}\n`));
  await new Promise((resolve) => {
    const stop = () => { monitor.stop(); resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return { stopped: true };
}

function mediaLibraryFromArgs(args) {
  return createMediaLibrary({ filePath: requireOption(args, 'state-path') });
}

async function runMediaCommand(command, args) {
  if (command === 'media-scan') {
    return scanMediaRoot(requireOption(args, 'root'), {
      maxEntries: numberOption(args, 'max-entries', 1024),
      maxDepth: numberOption(args, 'max-depth', 3),
      maxHashBytes: numberOption(args, 'max-hash-bytes', 256 * 1024 ** 2),
      hashFiles: args['hash-files'] === true
    });
  }
  if (command === 'media-play') {
    const plan = buildMediaPlaybackPlan(requireOption(args, 'file'), { platform: process.platform });
    if (args.confirm !== true) throw new Error('media-play requires --confirm');
    return { plan, result: await applyMediaPlayback(plan, { commandRunner: createCommandRunner(), approved: true, dryRun: false }) };
  }
  if (command === 'media-panel-open') {
    const plan = buildMediaPanelOpenPlan(requireOption(args, 'url'), { platform: process.platform });
    if (args.confirm !== true) throw new Error('media-panel-open requires --confirm');
    return { plan, result: await applyMediaPanelOpen(plan, { commandRunner: createCommandRunner(), approved: true, dryRun: false }) };
  }
  if (command === 'media-metadata') return collectMediaMetadata(requireOption(args, 'file'), { commandRunner: createCommandRunner(), maxOutputBytes: numberOption(args, 'max-output-bytes', 32768) });
  const library = mediaLibraryFromArgs(args);
  if (command === 'media-read') return library.read();
  if (command === 'media-favorite') return library.favorite(requireOption(args, 'file'), args.disable !== true);
  if (command === 'media-played') return library.played(requireOption(args, 'file'));
  if (command === 'media-playlist') return library.playlist(requireOption(args, 'name'), JSON.parse(requireOption(args, 'tracks')));
  if (command === 'media-export') return JSON.parse(await library.exportPlaylist(requireOption(args, 'name')));
  if (command === 'media-import') return library.importPlaylist(requireOption(args, 'playlist'));
  if (command === 'media-playback-plan') return library.playbackPlan(requireOption(args, 'file'));
  throw new Error(`Unknown media command: ${command}`);
}

async function runMediaPlayerCommand(args) {
  const queue = JSON.parse(requireOption(args, 'tracks'));
  const player = createMediaPlayer({ queue, initial: typeof args.initial === 'string' ? JSON.parse(args.initial) : {} });
  const action = args.action || 'read';
  if (action === 'read') return player.read();
  const value = action === 'select' ? numberOption(args, 'index', null) : action === 'shuffle' ? args.enabled === true : action === 'repeat' ? requireOption(args, 'mode') : undefined;
  return player.command(action, value);
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || 'facts';
  if (command === 'facts') return agentFromArgs(args).collectFacts();
  if (command === 'optimize') {
    const baseAgent = agentFromArgs(args);
    const agent = typeof args['history-path'] === 'string'
      ? createAuditedNativeAgent({ agent: baseAgent, historyStore: historyStoreFromArgs({ ...args, path: args['history-path'] }) })
      : baseAgent;
    return agent.optimize({
      apply: args.apply === true,
      profile: args.profile || undefined,
      approvedActions: approvals(args.approve),
      dryRun: args.apply !== true,
      allowAdmin: args['allow-admin'] === true
    });
  }
  if (['cache-preview', 'cache-clean', 'cache-quarantine-preview', 'cache-quarantine-apply', 'cache-quarantine-rollback'].includes(command)) return runCacheCommand(command, args);
  if (['organize-preview', 'organize-apply'].includes(command)) return runOrganizerCommand(command, args);
  if (command === 'file-inspect') return runFileInsightsCommand(args);
  if (['storage-preview', 'storage-cleanup'].includes(command)) return runStorageCommand(command, args);
  if (command === 'steward-history') return runStewardHistoryCommand(args);
  if (command === 'steward-monitor') return runStewardMonitorCommand(args);
  if (command === 'steward-schedule') return runStewardScheduleCommand(args);
  if (command === 'steward-daemon') return runStewardDaemonCommand(args);
  if (command === 'steward-report') return runStewardReportCommand(args);
  if (command === 'steward-trends') return runStewardTrendsCommand(args);
  if (['download-preflight', 'download-scan', 'download-verify'].includes(command)) return runDownloadCommand(command, args);
  if (command === 'download-monitor') return runDownloadMonitorCommand(args);
  if (['workload-preview', 'workload-apply'].includes(command)) return runWorkloadCommand(command, args);
  if (['workload-budget-preview', 'workload-budget-apply'].includes(command)) return runWorkloadBudgetCommand(command, args);
  if (['resource-limit-preview', 'resource-limit-apply'].includes(command)) return runResourceLimitCommand(command, args);
  if (command === 'game-session-monitor') return runGameSessionCommand(args);
  if (command === 'drive-health') return runDriveHealthCommand(args);
  if (command === 'filesystem-health') return runFilesystemHealthCommand(args);
  if (command === 'drive-benchmark') return runDriveBenchmarkCommand(args);
  if (command === 'network-overview') return runNetworkOverviewCommand(args);
  if (command === 'network-rate-monitor') return runNetworkRateMonitorCommand(args);
  if (['placement-preview', 'placement-apply', 'placement-rollback'].includes(command)) return runPlacementCommand(command, args);
  if (['placement-policy-preview', 'placement-policy-apply', 'placement-policy-rollback'].includes(command)) return runPlacementPolicyCommand(command, args);
  if (command === 'assistant') return runAssistantCommand(args);
  if (command === 'power-monitor') return runPowerMonitorCommand(args);
  if (['power-preview', 'power-apply', 'power-recommend'].includes(command)) return runPowerCommand(command, args);
  if (['process-overview', 'process-stop-preview', 'process-stop-apply'].includes(command)) return runProcessCommand(command, args);
  if (['startup-preview', 'startup-apply', 'startup-restore'].includes(command)) return runStartupCommand(command, args);
  if (['media-scan', 'media-play', 'media-panel-open', 'media-metadata', 'media-read', 'media-favorite', 'media-played', 'media-playlist', 'media-export', 'media-import', 'media-playback-plan'].includes(command)) return runMediaCommand(command, args);
  if (command === 'media-player') return runMediaPlayerCommand(args);
  if (command === 'media-panel') return buildMediaPanelPlan(requireOption(args, 'url'));
  if (command === 'storage-monitor') return runStorageMonitorCommand(args);
  throw new Error(`Unknown native command: ${command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
