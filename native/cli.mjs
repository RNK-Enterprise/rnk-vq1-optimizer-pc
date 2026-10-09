#!/usr/bin/env node
/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Explicit native-agent entry point. Optimization previews by default;
 * operating-system changes require --apply and destructive approvals.
 */

import { pathToFileURL } from 'url';
import { NativeOptimizerAgent } from './agent.js';
import { createCommandRunner } from './command-runner.js';
import { createPlatformAdapter } from './platform.js';
import { createAuditedNativeAgent } from './action-audit.js';
import { applyWorkloadPolicy, previewWorkloadPolicy } from './workload-governor.js';
import { applyWorkloadBudget, previewWorkloadBudget } from './workload-budget.js';
import { applyResourceLimits, previewResourceLimits } from './resource-limits.js';
import { createGameSessionMonitor } from './game-session.js';
import { collectDriveHealth, collectSmartHealth, collectSmartHealthForDrives } from './drive-health.js';
import { collectVolumeStorage } from './volume-storage.js';
import { collectFilesystemHealth } from './filesystem-health.js';
import { benchmarkDrive } from './drive-benchmark.js';
import { buildNetworkContentionPlan } from './network-manager.js';
import { createNetworkRateMonitor } from './network-rate.js';
import { createProcessResourceMonitor } from './process-rate.js';
import { applyFilePlacement, previewFilePlacement, rollbackFilePlacement } from './file-placement.js';
import { applyPlacementPolicy, previewPlacementPolicy, recommendPlacementTargets, rollbackPlacementPolicy } from './file-placement-policy.js';
import { interpretWorkstationQuestion } from './workstation-assistant.js';
import { approveWorkstationPolicy, buildWorkstationPolicyPlan } from './workstation-policy.js';
import { applyPowerProfile, previewPowerProfile, recommendPowerProfile } from './power-manager.js';
import { createPowerMonitor } from './power-monitor.js';
import { applyProcessStop, buildProcessOverview, previewProcessStop } from './process-manager.js';
import { applyStartupMutation, previewStartupMutation, restoreStartupMutation } from './startup-manager.js';
import { parseArgs, approvals, historyStoreFromArgs, jsonOption, listOption, numberOption, requireOption, textListOption } from './cli-utils.mjs';
import {
  runCacheCommand,
  runDownloadCommand,
  runDownloadMonitorCommand,
  runFileInsightsCommand,
  runOrganizerCommand,
  runProtectedRootsCommand,
  runReportScheduleCommand,
  runStewardDaemonCommand,
  runStewardHistoryCommand,
  runStewardMonitorCommand,
  runStewardReportCommand,
  runStewardSnapshotCommand,
  runStewardScheduleCommand,
  runStewardTrendsCommand,
  runStorageCommand,
  runStorageMonitorCommand
} from './cli-maintenance.mjs';
import { buildMediaPanelPlan, runMediaCommand, runMediaPlayerCommand } from './cli-media.mjs';
import { applyReportViewer, buildReportViewerPlan } from './report-viewer.js';

export function agentFromArgs(args, { adapter = createPlatformAdapter(), env = process.env } = {}) {
  return new NativeOptimizerAgent({
    adapter,
    gatewayUrl: args.gateway || env.OPTIMIZER_GATEWAY_URL || '',
    gatewayToken: args.token || env.OPTIMIZER_GATEWAY_TOKEN || '',
    clientId: args.client || env.OPTIMIZER_CLIENT_ID || 'native-local',
    profile: args.profile || env.OPTIMIZER_PROFILE || 'balanced',
    targetPid: args['target-pid'] === undefined ? null : numberOption(args, 'target-pid', null)
  });
}

export async function runWorkloadCommand(command, args, { adapter = createPlatformAdapter(), apply = applyWorkloadPolicy } = {}) {
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
  return { facts, plan, report: await apply(plan, { adapter, approvedPids, allowAdmin: args['allow-admin'] === true, dryRun: false }) };
}

export async function runWorkloadBudgetCommand(command, args, { adapter = createPlatformAdapter(), apply = applyWorkloadBudget } = {}) {
  const facts = await adapter.collectFacts();
  const budget = typeof args.budget === 'string' ? jsonOption(args, 'budget') : {
    cpuPercent: args['cpu-percent'] === undefined ? null : numberOption(args, 'cpu-percent', null),
    memoryBytes: args['memory-bytes'] === undefined ? null : numberOption(args, 'memory-bytes', null),
    ioBytesPerSecond: args['io-bytes-per-second'] === undefined ? null : numberOption(args, 'io-bytes-per-second', null),
    gpuPercent: args['gpu-percent'] === undefined ? null : numberOption(args, 'gpu-percent', null)
  };
  const plan = previewWorkloadBudget(facts, { budget, targetPids: listOption(args, 'target-pids'), enforcement: args.hard === true ? 'hard' : 'priority' });
  if (command === 'workload-budget-preview') return { facts, plan };
  if (args.confirm !== true) throw new Error('workload-budget-apply requires --confirm');
  const approvedPids = listOption(args, 'approve-pids');
  if (approvedPids.length === 0) throw new Error('workload-budget-apply requires --approve-pids');
  return { facts, plan, report: await apply(plan, { adapter, approvedPids, allowAdmin: args['allow-admin'] === true, dryRun: false }) };
}

export async function runResourceLimitCommand(command, args, { adapter = createPlatformAdapter(), apply = applyResourceLimits } = {}) {
  const facts = await adapter.collectFacts();
  const limits = typeof args.limits === 'string' ? jsonOption(args, 'limits') : {
    cpuPercent: args['cpu-percent'] === undefined ? null : numberOption(args, 'cpu-percent', null),
    memoryBytes: args['memory-bytes'] === undefined ? null : numberOption(args, 'memory-bytes', null),
    ioBytesPerSecond: args['io-bytes-per-second'] === undefined ? null : numberOption(args, 'io-bytes-per-second', null),
    ioDevice: typeof args['io-device'] === 'string' ? args['io-device'] : null
  };
  const plan = previewResourceLimits(facts, { limits, targetPids: listOption(args, 'target-pids') });
  if (command === 'resource-limit-preview') return { facts, plan };
  if (args.confirm !== true) throw new Error('resource-limit-apply requires --confirm');
  const approvedPids = listOption(args, 'approve-pids');
  if (approvedPids.length === 0) throw new Error('resource-limit-apply requires --approve-pids');
  return { facts, plan, report: await apply(plan, { adapter, approvedPids, allowAdmin: args['allow-admin'] === true, dryRun: false }) };
}

export async function runGameSessionCommand(args, { adapter = createPlatformAdapter(), monitorFactory = createGameSessionMonitor } = {}) {
  const autoApply = args['auto-apply'] === true;
  if (autoApply && args.confirm !== true) throw new Error('game-session-monitor --auto-apply requires --confirm');
  const approvedPids = listOption(args, 'approve-pids');
  if (autoApply && approvedPids.length === 0) throw new Error('game-session-monitor --auto-apply requires --approve-pids');
  const monitor = monitorFactory({
    adapter,
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

export async function runDriveHealthCommand(args, { inventoryCollector = collectDriveHealth, smartCollector = collectSmartHealth, smartAllCollector = collectSmartHealthForDrives, commandRunner = createCommandRunner(), platform = process.platform } = {}) {
  const inventory = await inventoryCollector({ platform, commandRunner });
  if (args['smart-all'] === true) return { inventory, smart: await smartAllCollector(inventory.drives, { platform, commandRunner }) };
  if (typeof args['smart-device'] !== 'string') return inventory;
  return { inventory, smart: await smartCollector(args['smart-device'], { platform, commandRunner }) };
}

export async function runReportViewerCommand(args, { apply = applyReportViewer, commandRunner = createCommandRunner(), platform = process.platform } = {}) {
  const plan = buildReportViewerPlan(requireOption(args, 'path'), { platform });
  if (args.confirm !== true) return plan;
  return { plan, result: await apply(plan, { commandRunner, approved: true, dryRun: false }) };
}

export async function runVolumeStorageCommand({ collector = collectVolumeStorage, commandRunner = createCommandRunner(), platform = process.platform } = {}) {
  return collector({ platform, commandRunner });
}

export async function runFilesystemHealthCommand(args, { collector = collectFilesystemHealth, commandRunner = createCommandRunner(), platform = process.platform } = {}) {
  return collector(requireOption(args, 'root'), { platform, commandRunner });
}

export async function runDriveBenchmarkCommand(args, { benchmark = benchmarkDrive } = {}) {
  return benchmark({ root: requireOption(args, 'root'), bytes: numberOption(args, 'bytes', 1024 * 1024) });
}

export async function runNetworkOverviewCommand(args, { adapter = createPlatformAdapter() } = {}) {
  const facts = await adapter.collectFacts();
  const samples = typeof args.samples === 'string' ? jsonOption(args, 'samples') : [];
  return { facts, plan: buildNetworkContentionPlan({ samples, connections: facts.networkConnections?.connections, gamePid: args['game-pid'] === undefined ? null : numberOption(args, 'game-pid', null), latencyMs: args['latency-ms'] === undefined ? null : numberOption(args, 'latency-ms', null) }) };
}

export async function runNetworkRateMonitorCommand(args, { adapter = createPlatformAdapter(), monitorFactory = createNetworkRateMonitor } = {}) {
  const monitor = monitorFactory({
    collectSample: async () => (await adapter.collectFacts()).network,
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

export async function runProcessRateMonitorCommand(args, { adapter = createPlatformAdapter(), monitorFactory = createProcessResourceMonitor } = {}) {
  const monitor = monitorFactory({
    collectSample: async () => ({ processes: (await adapter.collectFacts()).processes }),
    intervalMs: numberOption(args, 'interval-seconds', 5) * 1000,
    onReport: (report) => process.stdout.write(`${JSON.stringify(report)}\n`),
    onError: (error) => process.stderr.write(`process rate monitor: ${error.message}\n`)
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

export async function runPlacementCommand(command, args, { preview = previewFilePlacement, apply = applyFilePlacement, rollback = rollbackFilePlacement } = {}) {
  if (command === 'placement-rollback') return rollback(jsonOption(args, 'result'));
  const plan = preview({
    files: jsonOption(args, 'files'),
    sourceRoots: [requireOption(args, 'source-root')],
    targetRoot: requireOption(args, 'target-root'),
    protectedRoots: typeof args['protected-root'] === 'string' ? args['protected-root'].split(',').filter(Boolean) : [],
    targetFreeBytes: numberOption(args, 'target-free-bytes', null),
    maxEntries: numberOption(args, 'max-entries', 256)
  });
  if (command === 'placement-preview') return plan;
  if (args.confirm !== true) throw new Error('placement-apply requires --confirm');
  return { plan, result: await apply(plan, { approved: true, dryRun: false }) };
}

export async function runPlacementPolicyCommand(command, args, { preview = previewPlacementPolicy, apply = applyPlacementPolicy, rollback = rollbackPlacementPolicy } = {}) {
  if (command === 'placement-policy-rollback') return rollback(jsonOption(args, 'result'));
  const plan = preview(jsonOption(args, 'scan'), {
    targetRoots: jsonOption(args, 'target-roots'),
    sourceRoots: typeof args['source-root'] === 'string' ? args['source-root'].split(',').filter(Boolean) : undefined,
    protectedRoots: typeof args['protected-root'] === 'string' ? args['protected-root'].split(',').filter(Boolean) : [],
    targetFreeBytes: typeof args['target-free-bytes'] === 'string' ? jsonOption(args, 'target-free-bytes') : {},
    maxEntries: numberOption(args, 'max-entries', 256)
  });
  if (command === 'placement-policy-preview') return plan;
  if (args.confirm !== true) throw new Error('placement-policy-apply requires --confirm');
  return { plan, result: await apply(plan, { approved: true, dryRun: false }) };
}

export async function runPlacementRecommendationCommand(args) {
  return recommendPlacementTargets({
    volumes: jsonOption(args, 'volumes'),
    categories: typeof args.categories === 'string' ? jsonOption(args, 'categories') : undefined,
    mediaPreferences: typeof args['media-preferences'] === 'string' ? jsonOption(args, 'media-preferences') : undefined,
    protectedRoots: typeof args['protected-root'] === 'string' ? args['protected-root'].split(',').filter(Boolean) : [],
    minFreeBytes: numberOption(args, 'min-free-bytes', 0)
  });
}

export async function runAssistantCommand(args, { adapter = createPlatformAdapter() } = {}) {
  const facts = typeof args.facts === 'string' ? jsonOption(args, 'facts') : await adapter.collectFacts();
  const report = typeof args.report === 'string' ? jsonOption(args, 'report') : null;
  return interpretWorkstationQuestion(requireOption(args, 'question'), facts, { report });
}

export async function runWorkstationPolicyCommand(command, args, { adapter = createPlatformAdapter() } = {}) {
  if (command === 'policy-approve') return approveWorkstationPolicy(jsonOption(args, 'plan'), { approvedIds: textListOption(args, 'approve-ids') });
  const facts = typeof args.facts === 'string' ? jsonOption(args, 'facts') : await adapter.collectFacts();
  const report = typeof args.report === 'string' ? jsonOption(args, 'report') : null;
  return buildWorkstationPolicyPlan(facts, { report, maxActions: numberOption(args, 'max-actions', 16) });
}

export async function runPowerCommand(command, args, { adapter = createPlatformAdapter(), apply = applyPowerProfile, platform = process.platform } = {}) {
  const facts = await adapter.collectFacts();
  if (command === 'power-recommend') return { facts, recommendation: recommendPowerProfile(facts) };
  const profile = requireOption(args, 'profile');
  const plan = previewPowerProfile(profile, { platform, facts });
  if (command === 'power-preview') return { facts, plan };
  if (args.confirm !== true) throw new Error('power-apply requires --confirm');
  return { facts, plan, result: await apply(plan, { adapter, approved: true, allowAdmin: args['allow-admin'] === true, dryRun: false }) };
}

export async function runPowerMonitorCommand(args, { adapter = createPlatformAdapter(), monitorFactory = createPowerMonitor, platform = process.platform } = {}) {
  const autoApply = args['auto-apply'] === true;
  if (autoApply && args.confirm !== true) throw new Error('power-monitor --auto-apply requires --confirm');
  const monitor = monitorFactory({
    adapter,
    platform,
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

export async function runProcessCommand(command, args, { adapter = createPlatformAdapter(), apply = applyProcessStop } = {}) {
  const facts = await adapter.collectFacts();
  const protectedNames = typeof args['protected-name'] === 'string' ? args['protected-name'].split(',').filter(Boolean) : [];
  if (command === 'process-overview') return { facts, overview: buildProcessOverview(facts, { protectedNames, maxEntries: numberOption(args, 'max-entries', 128) }) };
  const plan = previewProcessStop(facts, numberOption(args, 'pid', null), { protectedNames });
  if (command === 'process-stop-preview') return { facts, plan };
  if (args.confirm !== true) throw new Error('process-stop-apply requires --confirm');
  return { facts, plan, result: await apply(plan, { adapter, approved: true, allowAdmin: args['allow-admin'] === true, dryRun: false }) };
}

export async function runStartupCommand(command, args, { adapter = createPlatformAdapter(), restore = restoreStartupMutation, preview = previewStartupMutation, apply = applyStartupMutation, commandRunner = createCommandRunner() } = {}) {
  if (command === 'startup-restore') {
    const receipt = jsonOption(args, 'receipt');
    return restore(receipt, { approved: true, allowAdmin: args['allow-admin'] === true, dryRun: args.confirm !== true, commandRunner });
  }
  const facts = typeof args.facts === 'string' ? jsonOption(args, 'facts') : await adapter.collectFacts();
  const plan = preview(facts, { name: requireOption(args, 'name'), location: requireOption(args, 'location'), protectedNames: typeof args['protected-name'] === 'string' ? args['protected-name'].split(',').filter(Boolean) : [] });
  if (command === 'startup-preview') return { facts, plan };
  if (args.confirm !== true) throw new Error('startup-apply requires --confirm');
  return { facts, plan, result: await apply(plan, { approved: true, allowAdmin: args['allow-admin'] === true, dryRun: false, commandRunner }) };
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
    return agent.optimize({ apply: args.apply === true, profile: args.profile || undefined, approvedActions: approvals(args.approve), dryRun: args.apply !== true, allowAdmin: args['allow-admin'] === true });
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
  if (command === 'steward-snapshot') return runStewardSnapshotCommand(args);
  if (command === 'steward-trends') return runStewardTrendsCommand(args);
  if (['report-schedule-preview', 'report-schedule-apply', 'report-schedule-restore'].includes(command)) return runReportScheduleCommand(command, args);
  if (['download-preflight', 'download-scan', 'download-verify'].includes(command)) return runDownloadCommand(command, args);
  if (command === 'download-monitor') return runDownloadMonitorCommand(args);
  if (['workload-preview', 'workload-apply'].includes(command)) return runWorkloadCommand(command, args);
  if (['workload-budget-preview', 'workload-budget-apply'].includes(command)) return runWorkloadBudgetCommand(command, args);
  if (['resource-limit-preview', 'resource-limit-apply'].includes(command)) return runResourceLimitCommand(command, args);
  if (command === 'game-session-monitor') return runGameSessionCommand(args);
  if (command === 'drive-health') return runDriveHealthCommand(args);
  if (command === 'report-open') return runReportViewerCommand(args);
  if (command === 'volume-storage') return runVolumeStorageCommand();
  if (command === 'filesystem-health') return runFilesystemHealthCommand(args);
  if (command === 'drive-benchmark') return runDriveBenchmarkCommand(args);
  if (command === 'network-overview') return runNetworkOverviewCommand(args);
  if (command === 'network-rate-monitor') return runNetworkRateMonitorCommand(args);
  if (command === 'process-rate-monitor') return runProcessRateMonitorCommand(args);
  if (['placement-preview', 'placement-apply', 'placement-rollback'].includes(command)) return runPlacementCommand(command, args);
  if (command === 'placement-recommend') return runPlacementRecommendationCommand(args);
  if (['placement-policy-preview', 'placement-policy-apply', 'placement-policy-rollback'].includes(command)) return runPlacementPolicyCommand(command, args);
  if (command === 'assistant') return runAssistantCommand(args);
  if (['policy-preview', 'policy-approve'].includes(command)) return runWorkstationPolicyCommand(command, args);
  if (command === 'power-monitor') return runPowerMonitorCommand(args);
  if (['power-preview', 'power-apply', 'power-recommend'].includes(command)) return runPowerCommand(command, args);
  if (['process-overview', 'process-stop-preview', 'process-stop-apply'].includes(command)) return runProcessCommand(command, args);
  if (['startup-preview', 'startup-apply', 'startup-restore'].includes(command)) return runStartupCommand(command, args);
  if (['media-scan', 'media-play', 'media-panel-open', 'media-metadata', 'media-read', 'media-favorite', 'media-played', 'media-playlist', 'media-export', 'media-import', 'media-playback-plan'].includes(command)) return runMediaCommand(command, args);
  if (command === 'media-player') return runMediaPlayerCommand(args);
  if (command === 'media-panel') return buildMediaPanelPlan(requireOption(args, 'url'));
  if (command === 'storage-monitor') return runStorageMonitorCommand(args);
  if (['protected-roots-read', 'protected-roots-add', 'protected-roots-remove'].includes(command)) return runProtectedRootsCommand(command, args);
  throw new Error(`Unknown native command: ${command}`);
}

export async function runCliEntrypoint({ entrypoint, run = runCli, write = (value) => process.stdout.write(value), errorWrite = (value) => process.stderr.write(value), target = process } = {}) {
  if (!entrypoint) return 0;
  try {
    const result = await run();
    write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    errorWrite(`${error.message}\n`);
    target.exitCode = 1;
    return 1;
  }
}

export function isCliEntrypoint(moduleUrl, executablePath) {
  return moduleUrl === pathToFileURL(executablePath || '').href;
}

runCliEntrypoint({ entrypoint: isCliEntrypoint(import.meta.url, process.argv[1]) });
