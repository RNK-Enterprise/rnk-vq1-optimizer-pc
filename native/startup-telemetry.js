/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded startup inventory. It reads only platform startup locations and
 * produces review facts; it never disables, deletes, or launches an entry.
 */

import fs from 'fs/promises';
import path from 'path';

export const STARTUP_TELEMETRY_VERSION = 1;
const EMPTY = Object.freeze([]);

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function json(output) { try { return JSON.parse(String(output || '')); } catch { return null; } }
function rows(value) { return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []; }
function available(commandRunner) { return Boolean(commandRunner && typeof commandRunner.run === 'function'); }
function normalize(row, platform) {
  return Object.freeze({ platform, name: text(row?.name ?? row?.Name) || 'unnamed-startup', command: text(row?.command ?? row?.Command ?? row?.Exec), location: text(row?.location ?? row?.Location ?? row?.path) || 'unknown', user: text(row?.user ?? row?.User) || null, enabled: row?.enabled !== false, authority: 'review-only' });
}

export function parseStartupTelemetry(output, { platform = 'unknown' } = {}) {
  if (platform === 'win32') {
    const parsed = json(output);
    const entries = rows(parsed).map((row) => normalize(row, platform)).slice(0, 256);
    return Object.freeze({ version: STARTUP_TELEMETRY_VERSION, available: entries.length > 0, entries: Object.freeze(entries), truncated: rows(parsed).length > 256, source: 'Win32_StartupCommand' });
  }
  const entries = String(output || '').split(/\r?\n/).filter((line) => line.trim()).map((line) => { const [name, location, command] = line.split('\t'); return normalize({ name, location, command }, platform); }).slice(0, 256);
  return Object.freeze({ version: STARTUP_TELEMETRY_VERSION, available: entries.length > 0, entries: Object.freeze(entries), truncated: String(output || '').split(/\r?\n/).filter((line) => line.trim()).length > 256, source: 'startup-text' });
}

async function scanRoots(roots, platform, fsImpl, pathImpl) {
  const entries = [];
  let unreadableRoots = 0;
  for (const root of roots) {
    let names;
    try { names = await fsImpl.readdir(root, { withFileTypes: true }); } catch { unreadableRoots += 1; continue; }
    for (const entry of names.slice(0, 128)) {
      if (entry.isSymbolicLink?.() || entry.isDirectory?.() || !entry.isFile?.() || !/\.(?:desktop|plist)$/i.test(entry.name)) continue;
      entries.push(normalize({ name: entry.name.replace(/\.(?:desktop|plist)$/i, ''), path: pathImpl.join(root, entry.name) }, platform));
      if (entries.length >= 256) break;
    }
    if (entries.length >= 256) break;
  }
  return Object.freeze({ version: STARTUP_TELEMETRY_VERSION, available: entries.length > 0, entries: Object.freeze(entries), truncated: entries.length >= 256, unreadableRoots, source: 'fixed-startup-roots' });
}

async function collectPosixStartup(platform, env, fsImpl, pathImpl) {
  const home = text(env?.HOME);
  const roots = platform === 'linux'
    ? [home ? pathImpl.join(home, '.config', 'autostart') : null, '/etc/xdg/autostart'].filter(Boolean)
    : [home ? pathImpl.join(home, 'Library', 'LaunchAgents') : null, '/Library/LaunchAgents', '/Library/LaunchDaemons'].filter(Boolean);
  const result = await scanRoots(roots, platform, fsImpl, pathImpl);
  return Object.freeze({ ...result, platform });
}

export async function collectStartupTelemetry({ platform = process.platform, commandRunner, env = process.env, fsImpl = fs, pathImpl = path } = {}) {
  if (platform === 'linux' || platform === 'darwin') return collectPosixStartup(platform, env, fsImpl, pathImpl);
  if (!available(commandRunner)) return Object.freeze({ version: STARTUP_TELEMETRY_VERSION, available: false, entries: EMPTY, truncated: false, source: 'command runner unavailable', platform });
  if (platform !== 'win32') return Object.freeze({ version: STARTUP_TELEMETRY_VERSION, available: false, entries: EMPTY, truncated: false, source: 'platform unsupported', platform });
  try {
    const result = await commandRunner.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location,User | ConvertTo-Json -Compress'], { timeoutMs: 5000, maxOutputBytes: 32768 });
    if (result?.code !== 0) return Object.freeze({ version: STARTUP_TELEMETRY_VERSION, available: false, entries: EMPTY, truncated: false, source: result?.stderr || 'startup command failed', platform });
    return Object.freeze({ ...parseStartupTelemetry(result.stdout, { platform }), platform });
  } catch (error) { return Object.freeze({ version: STARTUP_TELEMETRY_VERSION, available: false, entries: EMPTY, truncated: false, source: error.message, platform }); }
}
