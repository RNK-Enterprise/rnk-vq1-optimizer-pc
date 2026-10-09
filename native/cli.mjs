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
import { collectDriveHealth, collectSmartHealth } from './drive-health.js';
import { collectVolumeStorage } from './volume-storage.js';
import { collectFilesystemHealth } from './filesystem-health.js';
import { benchmarkDrive } from './drive-benchmark.js';
import { buildNetworkContentionPlan } from './network-manager.js';
import { createNetworkRateMonitor } from './network-rate.js';
import { applyFilePlacement, previewFilePlacement, rollbackFilePlacement } from './file-placement.js';
import { applyPlacementPolicy, previewPlacementPolicy, rollbackPlacementPolicy } from './file-placement-policy.js';
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
  runStewardScheduleCommand,
  runStewardTrendsCommand,
  runStorageCommand,
  runStorageMonitorCommand
} from './cli-maintenance.mjs';
import { buildMediaPanelPlan, runMediaCommand, runMediaPlayerCommand } from './cli-media.mjs';

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
  const plan = previewWorkloadBudget(facts, { budget, targetPids: listOption(args, 'target-pids'), enforcement: args.hard === true ? 'hard' : 'priority' });
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
    memoryBytes: args['memory-bytes'] === undefined ? null : numberOption(args, 'memory-bytes', null),
    ioBytesPerSecond: args['io-bytes-per-second'] === undefined ? null : numberOption(args, 'io-bytes-per-second', null),
    ioDevice: typeof args['io-device'] === 'string' ? args['io-device'] : null
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

async function runVolumeStorageCommand() {
  return collectVolumeStorage({ platform: process.platform, commandRunner: createCommandRunner() });
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

async function runWorkstationPolicyCommand(command, args) {
  if (command === 'policy-approve') return approveWorkstationPolicy(jsonOption(args, 'plan'), { approvedIds: textListOption(args, 'approve-ids') });
  const facts = typeof args.facts === 'string' ? jsonOption(args, 'facts') : await createPlatformAdapter().collectFacts();
  const report = typeof args.report === 'string' ? jsonOption(args, 'report') : null;
  return buildWorkstationPolicyPlan(facts, { report, maxActions: numberOption(args, 'max-actions', 16) });
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
  if (command === 'steward-trends') return runStewardTrendsCommand(args);
  if (['report-schedule-preview', 'report-schedule-apply', 'report-schedule-restore'].includes(command)) return runReportScheduleCommand(command, args);
  if (['download-preflight', 'download-scan', 'download-verify'].includes(command)) return runDownloadCommand(command, args);
  if (command === 'download-monitor') return runDownloadMonitorCommand(args);
  if (['workload-preview', 'workload-apply'].includes(command)) return runWorkloadCommand(command, args);
  if (['workload-budget-preview', 'workload-budget-apply'].includes(command)) return runWorkloadBudgetCommand(command, args);
  if (['resource-limit-preview', 'resource-limit-apply'].includes(command)) return runResourceLimitCommand(command, args);
  if (command === 'game-session-monitor') return runGameSessionCommand(args);
  if (command === 'drive-health') return runDriveHealthCommand(args);
  if (command === 'volume-storage') return runVolumeStorageCommand();
  if (command === 'filesystem-health') return runFilesystemHealthCommand(args);
  if (command === 'drive-benchmark') return runDriveBenchmarkCommand(args);
  if (command === 'network-overview') return runNetworkOverviewCommand(args);
  if (command === 'network-rate-monitor') return runNetworkRateMonitorCommand(args);
  if (['placement-preview', 'placement-apply', 'placement-rollback'].includes(command)) return runPlacementCommand(command, args);
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

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
