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

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || 'facts';
  if (command === 'facts') return agentFromArgs(args).collectFacts();
  if (command === 'optimize') {
    const agent = agentFromArgs(args);
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
