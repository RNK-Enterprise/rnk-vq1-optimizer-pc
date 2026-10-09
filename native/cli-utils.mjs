/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded native CLI argument and policy adapters. These helpers contain no
 * command dispatch and never turn user input into an executable command.
 */

import { createCommandRunner } from './command-runner.js';
import { createStewardHistoryStore } from './steward-history.js';
import { createStoragePressureGuard } from './storage-pressure.js';
import { createDownloadGuard } from './download-guard.js';
import { createMediaLibrary } from './media-library.js';
import { createProtectedRootsStore } from './protected-roots.js';

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

export function numberOption(args, name, fallback) {
  if (args[name] === undefined) return fallback;
  const value = Number(args[name]);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be numeric`);
  return value;
}

export function approvals(value) {
  if (value === true) return true;
  if (typeof value !== 'string' || value.length === 0) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function requireOption(args, name) {
  if (typeof args[name] !== 'string' || args[name].length === 0) throw new Error(`--${name} is required`);
  return args[name];
}

export function jsonOption(args, name) {
  try { return JSON.parse(requireOption(args, name)); } catch (error) { throw new Error(`--${name} must contain valid JSON: ${error.message}`); }
}

export function listOption(args, name) {
  if (args[name] === undefined) return [];
  if (typeof args[name] !== 'string') throw new Error(`--${name} must be a comma-separated list`);
  const values = args[name].split(',').map((value) => Number(value.trim()));
  if (values.some((value) => !Number.isInteger(value) || value < 1)) throw new Error(`--${name} contains an invalid PID`);
  return [...new Set(values)];
}

export function textListOption(args, name) {
  if (args[name] === undefined) return [];
  if (typeof args[name] !== 'string') throw new Error(`--${name} must be a comma-separated list`);
  return [...new Set(args[name].split(',').map((value) => value.trim()).filter(Boolean))];
}

export function historyStoreFromArgs(args) {
  return createStewardHistoryStore({ filePath: requireOption(args, 'path'), maxEntries: numberOption(args, 'max-entries', 2048) });
}

export function storagePolicyFromArgs(args) {
  return {
    warningPercent: numberOption(args, 'warning-percent', 20),
    criticalPercent: numberOption(args, 'critical-percent', 10),
    emergencyPercent: numberOption(args, 'emergency-percent', 5),
    targetFreeBytes: numberOption(args, 'target-free-gb', 5) * 1024 ** 3,
    minAgeHours: numberOption(args, 'min-age-hours', 24),
    maxEntries: numberOption(args, 'max-entries', 2000)
  };
}

export function storageGuardFromArgs(args, { platform = process.platform, commandRunner = createCommandRunner(), env = process.env } = {}) {
  return createStoragePressureGuard({
    platform,
    commandRunner,
    env,
    policy: storagePolicyFromArgs(args)
  });
}

export function protectedRootsStoreFromArgs(args) {
  return createProtectedRootsStore({ filePath: requireOption(args, 'protected-store') });
}

export async function storageOptionsFromArgs(args) {
  const configured = typeof args['protected-store'] === 'string'
    ? await protectedRootsStoreFromArgs(args).read()
    : { state: 'ready', roots: [] };
  if (configured.state !== 'ready') throw new Error(configured.reason);
  if (args.enable === true) throw new Error('--enable must be a comma-separated list');
  const requested = typeof args['protected-root'] === 'string' ? args['protected-root'].split(',').map((value) => value.trim()).filter(Boolean) : [];
  return {
    enabledCategories: approvals(args.enable),
    allowUnsafeCategories: args['allow-unsafe'] === true,
    allowAdmin: args['allow-admin'] === true,
    protectedRoots: [...configured.roots, ...requested],
    abandonedRuntimeRoots: typeof args['abandoned-root'] === 'string'
      ? args['abandoned-root'].split(',').map((value) => value.trim()).filter(Boolean)
      : []
  };
}

export function downloadGuardFromArgs(args) {
  return createDownloadGuard({ hashFiles: args['hash-files'] === true });
}

export function mediaLibraryFromArgs(args) {
  return createMediaLibrary({ filePath: requireOption(args, 'state-path') });
}
