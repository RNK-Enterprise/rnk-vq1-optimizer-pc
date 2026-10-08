/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Exact-entry startup mutation authority. Plans are built from observed facts;
 * mutation requires approval and produces a reversible receipt.
 */

import fs from 'fs/promises';
import path from 'path';

export const STARTUP_MANAGER_VERSION = 1;
const WINDOWS_REGISTRY = Object.freeze({
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run': 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run': 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
});

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function rows(value) { return Array.isArray(value) ? value.filter(record).slice(0, 256) : []; }
function safeName(value) { return Boolean(text(value)?.match(/^[A-Za-z0-9 _.-]{1,128}$/)); }
function inside(root, candidate, pathImpl) { const relative = pathImpl.relative(root, candidate); return relative !== '' && !relative.startsWith('..') && !pathImpl.isAbsolute(relative); }
function resultFromCommand(result, operation) { return result?.code === 0 ? { ok: true, operation } : { ok: false, operation, reason: result?.stderr || `${operation} failed` }; }
function registryPath(location) { const raw = text(location)?.replaceAll('/', '\\'); return raw && WINDOWS_REGISTRY[raw] ? WINDOWS_REGISTRY[raw] : null; }
function posixRoots(platform, env, pathImpl) {
  const home = text(env?.HOME);
  return platform === 'darwin'
    ? [home ? pathImpl.join(home, 'Library', 'LaunchAgents') : null, '/Library/LaunchAgents', '/Library/LaunchDaemons'].filter(Boolean)
    : [home ? pathImpl.join(home, '.config', 'autostart') : null, '/etc/xdg/autostart'].filter(Boolean);
}
function protectedEntry(entry, protectedNames) { return protectedNames.some((name) => name.toLowerCase() === text(entry.name)?.toLowerCase()); }
function exactEntry(facts, name, location) { return rows(facts?.startup?.entries).find((entry) => text(entry.name) === name && text(entry.location) === location) || null; }

export function previewStartupMutation(facts, { name, location, protectedNames = [] } = {}) {
  if (!record(facts)) throw new TypeError('Startup facts must be an object');
  const entryName = text(name);
  const entryLocation = text(location);
  if (!safeName(entryName) || !entryLocation) return Object.freeze({ version: STARTUP_MANAGER_VERSION, state: 'refused', reason: 'exact startup name and location are required' });
  const entry = exactEntry(facts, entryName, entryLocation);
  if (!entry) return Object.freeze({ version: STARTUP_MANAGER_VERSION, state: 'refused', reason: 'startup entry was not observed' });
  const protectedList = Array.isArray(protectedNames) ? protectedNames.filter((item) => safeName(item)).map((item) => item.trim()) : [];
  if (protectedEntry(entry, protectedList)) return Object.freeze({ version: STARTUP_MANAGER_VERSION, state: 'refused', reason: 'startup entry is protected', entry });
  if (entry.enabled === false) return Object.freeze({ version: STARTUP_MANAGER_VERSION, state: 'refused', reason: 'startup entry is already disabled', entry });
  return Object.freeze({ version: STARTUP_MANAGER_VERSION, state: 'plan-ready', operation: 'disable-startup-entry', platform: text(facts.platform) || 'unknown', entry: Object.freeze({ name: entryName, location: entryLocation, command: text(entry.command), enabled: true }), requiresApproval: true, reversible: true });
}

function validatePlan(plan) {
  if (!record(plan) || plan.version !== STARTUP_MANAGER_VERSION || plan.state !== 'plan-ready' || plan.operation !== 'disable-startup-entry') throw new TypeError('Startup mutation plan is invalid');
  if (!safeName(plan.entry?.name) || !text(plan.entry?.location)) throw new TypeError('Startup mutation plan entry is invalid');
  return plan;
}
async function posixDisable(plan, { fsImpl, pathImpl, env }) {
  const source = pathImpl.resolve(plan.entry.location);
  const roots = posixRoots(plan.platform, env, pathImpl).map((root) => pathImpl.resolve(root));
  if (!roots.some((root) => inside(root, source, pathImpl))) return { ok: false, reason: 'startup path is outside the fixed platform roots' };
  let sourceStat;
  try { sourceStat = await fsImpl.lstat(source); } catch (error) { return { ok: false, reason: error.message }; }
  if (!sourceStat.isFile?.() || sourceStat.isSymbolicLink?.()) return { ok: false, reason: 'startup entry must be a regular non-symlink file' };
  const destination = `${source}.rnk-disabled`;
  try { await fsImpl.lstat(destination); return { ok: false, reason: 'startup disabled destination already exists' }; } catch (error) { if (error?.code !== 'ENOENT') return { ok: false, reason: error.message }; }
  try { await fsImpl.rename(source, destination); } catch (error) { return { ok: false, reason: error.message }; }
  return { ok: true, receipt: Object.freeze({ version: STARTUP_MANAGER_VERSION, action: 'restore-startup-entry', platform: plan.platform, source, destination }) };
}
async function windowsDisable(plan, { commandRunner }) {
  const location = registryPath(plan.entry.location);
  if (!location || !commandRunner || typeof commandRunner.run !== 'function') return { ok: false, reason: 'Windows startup registry authority is unavailable' };
  if (!text(plan.entry.command) || plan.entry.command.length > 8192) return { ok: false, reason: 'startup command evidence is unavailable or too large' };
  let result;
  try { result = await commandRunner.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Remove-ItemProperty -Path $args[0] -Name $args[1] -ErrorAction Stop', '--', location, plan.entry.name]); } catch (error) { return { ok: false, reason: error.message }; }
  const applied = resultFromCommand(result, 'disable-startup-entry');
  return applied.ok ? { ok: true, receipt: Object.freeze({ version: STARTUP_MANAGER_VERSION, action: 'restore-startup-entry', platform: 'win32', registryPath: location, name: plan.entry.name, command: plan.entry.command }) } : applied;
}

export async function applyStartupMutation(plan, { approved = false, allowAdmin = false, dryRun = true, fsImpl = fs, pathImpl = path, env = process.env, commandRunner } = {}) {
  validatePlan(plan);
  if (!approved && !dryRun) return Object.freeze({ state: 'approval-required', applied: false, reason: 'explicit approval is required' });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, plan });
  const adminRequired = (plan.platform === 'win32' && plan.entry.location.startsWith('HKLM\\')) || (plan.platform !== 'win32' && /^\/(?:etc|Library)\//.test(pathImpl.resolve(plan.entry.location)));
  if (adminRequired && !allowAdmin) return Object.freeze({ state: 'admin-required', applied: false });
  let result;
  if (plan.platform === 'win32') result = await windowsDisable(plan, { commandRunner });
  else if (plan.platform === 'linux' || plan.platform === 'darwin') result = await posixDisable(plan, { fsImpl, pathImpl, env });
  else result = { ok: false, reason: `unsupported startup platform: ${plan.platform}` };
  return Object.freeze(result.ok ? { state: 'applied', applied: true, receipt: result.receipt } : { state: 'rejected', applied: false, reason: result.reason });
}

export async function restoreStartupMutation(receipt, { approved = false, allowAdmin = false, dryRun = true, fsImpl = fs, commandRunner } = {}) {
  if (!record(receipt) || receipt.version !== STARTUP_MANAGER_VERSION || receipt.action !== 'restore-startup-entry') throw new TypeError('Startup restore receipt is invalid');
  if (!approved && !dryRun) return Object.freeze({ state: 'approval-required', restored: false, reason: 'explicit approval is required' });
  if (dryRun) return Object.freeze({ state: 'preview', restored: false, receipt });
  const adminRequired = receipt.platform === 'win32' && receipt.registryPath.startsWith('HKLM:');
  if (adminRequired && !allowAdmin) return Object.freeze({ state: 'admin-required', restored: false });
  if (receipt.platform === 'win32') {
    if (!commandRunner || typeof commandRunner.run !== 'function') return Object.freeze({ state: 'rejected', restored: false, reason: 'Windows startup registry authority is unavailable' });
    let result;
    try { result = await commandRunner.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'New-ItemProperty -Path $args[0] -Name $args[1] -Value $args[2] -PropertyType String -Force -ErrorAction Stop', '--', receipt.registryPath, receipt.name, receipt.command]); } catch (error) { return Object.freeze({ state: 'rejected', restored: false, reason: error.message }); }
    return Object.freeze(resultFromCommand(result, 'restore-startup-entry').ok ? { state: 'restored', restored: true } : { state: 'rejected', restored: false, reason: resultFromCommand(result, 'restore-startup-entry').reason });
  }
  if (receipt.platform !== 'linux' && receipt.platform !== 'darwin') return Object.freeze({ state: 'rejected', restored: false, reason: `unsupported startup platform: ${receipt.platform}` });
  try { await fsImpl.lstat(receipt.source); return Object.freeze({ state: 'rejected', restored: false, reason: 'original startup path is already occupied' }); } catch (error) { if (error?.code !== 'ENOENT') return Object.freeze({ state: 'rejected', restored: false, reason: error?.message || error?.code || 'startup restore failed' }); }
  try { await fsImpl.rename(receipt.destination, receipt.source); return Object.freeze({ state: 'restored', restored: true }); } catch (error) { return Object.freeze({ state: 'rejected', restored: false, reason: error.message }); }
}
