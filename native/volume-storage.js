/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Read-only mounted-volume inventory. Commands are fixed per platform and
 * malformed or unavailable volume facts remain explicit rather than inferred.
 */

export const VOLUME_STORAGE_VERSION = 1;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function number(value) {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function rows(value) { return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []; }
function mount(value) {
  const normalized = text(value);
  if (!normalized) return null;
  return /^[A-Za-z]:$/.test(normalized) ? normalized.toUpperCase() : normalized;
}
function volume(platform, values) {
  const totalBytes = number(values.totalBytes);
  const freeBytes = number(values.freeBytes);
  return Object.freeze({
    mount: mount(values.mount),
    device: text(values.device),
    filesystem: text(values.filesystem),
    health: text(values.health)?.toLowerCase() || 'unknown',
    totalBytes,
    freeBytes,
    usedBytes: totalBytes === null || freeBytes === null ? null : Math.max(0, totalBytes - Math.min(totalBytes, freeBytes)),
    usedPercent: totalBytes && freeBytes !== null ? Math.min(100, Math.max(0, ((totalBytes - Math.min(totalBytes, freeBytes)) / totalBytes) * 100)) : null,
    readOnly: values.readOnly === true,
    type: text(values.type),
    platform
  });
}
function result(platform, volumes, source, reason = null) {
  return Object.freeze({ version: VOLUME_STORAGE_VERSION, platform, available: volumes.length > 0, volumes: Object.freeze(volumes), source, reason });
}

export function parseWindowsVolumeStorage(output) {
  let parsed;
  try { parsed = JSON.parse(String(output || '')); } catch { return result('win32', [], 'Get-Volume', 'invalid JSON'); }
  const volumes = rows(parsed).map((row) => {
    const driveLetter = text(row?.DriveLetter);
    const normalizedDrive = driveLetter ? `${driveLetter.replace(/:$/, '')}:`.toUpperCase() : null;
    return volume('win32', {
      mount: normalizedDrive,
      device: normalizedDrive,
      filesystem: row?.FileSystem,
      health: row?.HealthStatus,
      totalBytes: row?.Size,
      freeBytes: row?.SizeRemaining,
      readOnly: row?.IsReadOnly === true,
      type: row?.DriveType
    });
  }).filter((item) => item.mount && item.totalBytes !== null);
  return result('win32', volumes, 'Get-Volume');
}

function parsePosixRows(output, platform, blockMultiplier, fields) {
  const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
  const volumes = lines.slice(1).map((line) => {
    const values = line.trim().split(/\s+/);
    if (values.length < fields.minimum) return null;
    const mountIndex = fields.mountIndex;
    const total = number(values[fields.totalIndex]);
    const free = number(values[fields.freeIndex]);
    if (total === null || free === null) return null;
    return volume(platform, {
      mount: values.slice(mountIndex).join(' '),
      device: values[0],
      filesystem: null,
      totalBytes: total * blockMultiplier,
      freeBytes: free * blockMultiplier,
      readOnly: false,
      type: null
    });
  }).filter(Boolean);
  return result(platform, volumes, fields.source);
}

export function parseLinuxVolumeStorage(output) {
  return parsePosixRows(output, 'linux', 1, { minimum: 4, totalIndex: 1, freeIndex: 2, mountIndex: 3, source: 'df' });
}

export function parseDarwinVolumeStorage(output) {
  return parsePosixRows(output, 'darwin', 1024, { minimum: 6, totalIndex: 1, freeIndex: 3, mountIndex: 5, source: 'df' });
}

export async function collectVolumeStorage({ platform = process.platform, commandRunner } = {}) {
  if (!commandRunner || typeof commandRunner.run !== 'function') return result(platform, [], 'unavailable', 'command runner unavailable');
  const command = platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Get-Volume | Where-Object { $_.DriveLetter -and $_.Size -ne $null } | Select-Object DriveLetter,FileSystem,HealthStatus,Size,SizeRemaining,IsReadOnly,DriveType | ConvertTo-Json -Compress'], { timeoutMs: 5000, maxOutputBytes: 32768 }]
    : platform === 'linux'
      ? ['df', ['-B1', '--output=source,size,avail,target'], { timeoutMs: 2500, maxOutputBytes: 32768 }]
      : platform === 'darwin' ? ['df', ['-Pk'], { timeoutMs: 2500, maxOutputBytes: 32768 }] : null;
  if (!command) return result(platform, [], 'unsupported', 'platform unsupported');
  try {
    const response = await commandRunner.run(command[0], command[1], command[2]);
    if (response?.code !== 0) return result(platform, [], command[0], response?.stderr || 'volume command failed');
    const parsed = platform === 'win32' ? parseWindowsVolumeStorage(response.stdout) : platform === 'linux' ? parseLinuxVolumeStorage(response.stdout) : parseDarwinVolumeStorage(response.stdout);
    return Object.freeze({ ...parsed, commandAvailable: true });
  } catch (error) { return result(platform, [], command[0], error.message); }
}
