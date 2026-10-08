/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Read-only filesystem and volume evidence. Roots are explicit, commands are
 * fixed per platform, and checker failures remain unavailable.
 */

import path from 'path';

export const FILESYSTEM_HEALTH_VERSION = 1;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function number(value) { const parsed = typeof value === 'string' && value.trim() ? Number(value) : value; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function localRoot(value) { const candidate = text(value); return candidate && !/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) && !candidate.includes('..') ? candidate : null; }
function empty(platform, reason) { return Object.freeze({ version: FILESYSTEM_HEALTH_VERSION, platform, available: false, root: null, filesystem: null, health: 'unknown', totalBytes: null, freeBytes: null, source: 'unavailable', reason }); }

export function buildFilesystemHealthPlan(root, { platform = process.platform, pathImpl = path } = {}) {
  const candidate = localRoot(root);
  if (!candidate) return Object.freeze({ version: FILESYSTEM_HEALTH_VERSION, platform, state: 'refused', root: null, reason: 'explicit local filesystem root is required' });
  const resolved = pathImpl.resolve(candidate);
  if (platform === 'win32') {
    const match = resolved.match(/^([A-Za-z]):(?:\\|$)/);
    if (!match) return Object.freeze({ version: FILESYSTEM_HEALTH_VERSION, platform, state: 'refused', root: resolved, reason: 'Windows filesystem health requires a drive root' });
    return Object.freeze({ version: FILESYSTEM_HEALTH_VERSION, platform, state: 'plan-ready', root: resolved, operation: 'inspect-filesystem-health', command: Object.freeze({ file: 'powershell.exe', args: Object.freeze(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Get-Volume -DriveLetter ${match[1]} | Select-Object DriveLetter,FileSystem,HealthStatus,Size,SizeRemaining | ConvertTo-Json -Compress`]) }), mutation: 'none' });
  }
  if (!['linux', 'darwin'].includes(platform)) return Object.freeze({ version: FILESYSTEM_HEALTH_VERSION, platform, state: 'unsupported-platform', root: resolved, reason: 'filesystem health checker is unavailable' });
  const command = platform === 'linux'
    ? { file: 'findmnt', args: ['--json', '--target', resolved, '--output', 'TARGET,SOURCE,FSTYPE,OPTIONS'] }
    : { file: 'diskutil', args: ['info', resolved] };
  return Object.freeze({ version: FILESYSTEM_HEALTH_VERSION, platform, state: 'plan-ready', root: resolved, operation: 'inspect-filesystem-health', command: Object.freeze({ file: command.file, args: Object.freeze(command.args) }), mutation: 'none' });
}

export function parseWindowsFilesystemHealth(output, { root = null } = {}) {
  try {
    const parsed = JSON.parse(String(output || ''));
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!record(row)) return empty('win32', 'filesystem checker returned an invalid record');
    return Object.freeze({ version: FILESYSTEM_HEALTH_VERSION, platform: 'win32', available: true, root: text(root), filesystem: text(row.FileSystem), health: text(row.HealthStatus)?.toLowerCase() || 'unknown', totalBytes: number(row.Size), freeBytes: number(row.SizeRemaining), source: 'Get-Volume' });
  } catch { return empty('win32', 'filesystem checker returned invalid JSON'); }
}

export function parseLinuxFilesystemHealth(output, { root = null } = {}) {
  try {
    const parsed = JSON.parse(String(output || ''));
    const row = Array.isArray(parsed?.filesystems) ? parsed.filesystems[0] : null;
    if (!record(row)) return empty('linux', 'findmnt returned no filesystem record');
    return Object.freeze({ version: FILESYSTEM_HEALTH_VERSION, platform: 'linux', available: true, root: text(root), filesystem: text(row.fstype), health: 'unknown', totalBytes: null, freeBytes: null, mountpoint: text(row.target), device: text(row.source), options: text(row.options), source: 'findmnt' });
  } catch { return empty('linux', 'findmnt returned invalid JSON'); }
}

export function parseDarwinFilesystemHealth(output, { root = null } = {}) {
  const source = String(output || '');
  const filesystem = source.match(/File System Personality:\s*(.+)/i)?.[1]?.trim() || source.match(/Type \(Bundle\):\s*(.+)/i)?.[1]?.trim() || null;
  const device = source.match(/Device Identifier:\s*(.+)/i)?.[1]?.trim() || null;
  const state = source.match(/Mounted:\s*(Yes|No)/i)?.[1]?.toLowerCase() === 'yes' ? 'mounted' : 'unknown';
  return Object.freeze({ version: FILESYSTEM_HEALTH_VERSION, platform: 'darwin', available: Boolean(filesystem || device), root: text(root), filesystem, health: state, totalBytes: null, freeBytes: null, device, source: 'diskutil info' });
}

export async function collectFilesystemHealth(root, { platform = process.platform, pathImpl = path, commandRunner } = {}) {
  const plan = buildFilesystemHealthPlan(root, { platform, pathImpl });
  if (plan.state !== 'plan-ready') return Object.freeze({ ...plan, available: false });
  if (!commandRunner || typeof commandRunner.run !== 'function') return Object.freeze({ ...plan, available: false, reason: 'command runner unavailable' });
  try {
    const result = await commandRunner.run(plan.command.file, plan.command.args, { timeoutMs: 5000, maxOutputBytes: 16384 });
    if (result?.code !== 0) return Object.freeze({ ...plan, available: false, reason: result?.stderr || 'filesystem checker failed' });
    const facts = platform === 'win32' ? parseWindowsFilesystemHealth(result.stdout, { root: plan.root }) : platform === 'linux' ? parseLinuxFilesystemHealth(result.stdout, { root: plan.root }) : parseDarwinFilesystemHealth(result.stdout, { root: plan.root });
    return Object.freeze({ ...facts, plan });
  } catch (error) { return Object.freeze({ ...plan, available: false, reason: error.message }); }
}
