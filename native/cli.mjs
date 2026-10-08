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
import { createStoragePressureGuard } from './storage-pressure.js';
import { createStewardHistoryStore } from './steward-history.js';
import { createStewardMonitor } from './steward-monitor.js';
import { createDownloadGuard } from './download-guard.js';
import { createDownloadMonitor } from './download-monitor.js';
import { createAuditedNativeAgent } from './action-audit.js';
import { createMediaLibrary, scanMediaRoot } from './media-library.js';
import { buildDailyWorkstationReport } from './workstation-report.js';
import { applyWorkloadPolicy, previewWorkloadPolicy } from './workload-governor.js';
import { collectDriveHealth, collectSmartHealth } from './drive-health.js';
import { benchmarkDrive } from './drive-benchmark.js';
import { buildNetworkContentionPlan } from './network-manager.js';
import { applyFilePlacement, previewFilePlacement, rollbackFilePlacement } from './file-placement.js';
import { interpretWorkstationQuestion } from './workstation-assistant.js';
import { applyPowerProfile, previewPowerProfile, recommendPowerProfile } from './power-manager.js';
import { applyProcessStop, buildProcessOverview, previewProcessStop } from './process-manager.js';

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
  const cleaner = createCacheCleaner();
  const preview = await cleaner.preview({
    target: args.target || 'user-temp',
    maxAgeHours: numberOption(args, 'max-age-hours', 24),
    maxEntries: numberOption(args, 'max-entries', 2000)
  });
  if (command === 'cache-preview') return preview;
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

async function runDriveHealthCommand(args) {
  const inventory = await collectDriveHealth({ platform: process.platform, commandRunner: createCommandRunner() });
  if (typeof args['smart-device'] !== 'string') return inventory;
  return { inventory, smart: await collectSmartHealth(args['smart-device'], { platform: process.platform, commandRunner: createCommandRunner() }) };
}

async function runDriveBenchmarkCommand(args) {
  return benchmarkDrive({ root: requireOption(args, 'root'), bytes: numberOption(args, 'bytes', 1024 * 1024) });
}

async function runNetworkOverviewCommand(args) {
  const facts = await createPlatformAdapter().collectFacts();
  const samples = typeof args.samples === 'string' ? jsonOption(args, 'samples') : [];
  return { facts, plan: buildNetworkContentionPlan({ samples, gamePid: args['game-pid'] === undefined ? null : numberOption(args, 'game-pid', null), latencyMs: args['latency-ms'] === undefined ? null : numberOption(args, 'latency-ms', null) }) };
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
  if (['cache-preview', 'cache-clean'].includes(command)) return runCacheCommand(command, args);
  if (['organize-preview', 'organize-apply'].includes(command)) return runOrganizerCommand(command, args);
  if (['storage-preview', 'storage-cleanup'].includes(command)) return runStorageCommand(command, args);
  if (command === 'steward-history') return runStewardHistoryCommand(args);
  if (command === 'steward-monitor') return runStewardMonitorCommand(args);
  if (command === 'steward-report') return runStewardReportCommand(args);
  if (['download-preflight', 'download-scan', 'download-verify'].includes(command)) return runDownloadCommand(command, args);
  if (command === 'download-monitor') return runDownloadMonitorCommand(args);
  if (['workload-preview', 'workload-apply'].includes(command)) return runWorkloadCommand(command, args);
  if (command === 'drive-health') return runDriveHealthCommand(args);
  if (command === 'drive-benchmark') return runDriveBenchmarkCommand(args);
  if (command === 'network-overview') return runNetworkOverviewCommand(args);
  if (['placement-preview', 'placement-apply', 'placement-rollback'].includes(command)) return runPlacementCommand(command, args);
  if (command === 'assistant') return runAssistantCommand(args);
  if (['power-preview', 'power-apply', 'power-recommend'].includes(command)) return runPowerCommand(command, args);
  if (['process-overview', 'process-stop-preview', 'process-stop-apply'].includes(command)) return runProcessCommand(command, args);
  if (['media-scan', 'media-read', 'media-favorite', 'media-played', 'media-playlist', 'media-export', 'media-import', 'media-playback-plan'].includes(command)) return runMediaCommand(command, args);
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
