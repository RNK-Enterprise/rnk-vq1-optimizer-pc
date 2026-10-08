/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Cross-platform drive inventory and optional SMART health observation. The
 * command executable is fixed, device arguments are validated, and missing
 * health tooling remains unavailable rather than being treated as healthy.
 */

export const DRIVE_HEALTH_VERSION = 1;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function number(value) { const parsed = typeof value === 'string' && value.trim() ? Number(value) : value; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function rows(value) { return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []; }
function mediaType(row) {
  const declared = text(row?.MediaType ?? row?.mediaType ?? row?.type)?.toLowerCase();
  if (declared?.includes('ssd') || declared?.includes('solid')) return 'ssd';
  if (declared?.includes('hdd') || declared?.includes('hard')) return 'hdd';
  const rotational = row?.ROTA ?? row?.rota;
  if (rotational === true || rotational === 1 || String(rotational).toLowerCase() === 'true') return 'hdd';
  if (rotational === false || rotational === 0 || String(rotational).toLowerCase() === 'false') return 'ssd';
  return 'unknown';
}

function healthState(value) {
  const normalized = text(value)?.toLowerCase();
  if (['healthy', 'ok', 'online', 'passed', 'pass'].includes(normalized)) return 'healthy';
  if (['warning', 'degraded', 'predictive-failure'].includes(normalized)) return 'degraded';
  if (['failed', 'unhealthy', 'offline', 'critical', 'fail'].includes(normalized)) return 'failed';
  return 'unknown';
}

function drive(row, platform) {
  const mountpoints = Array.isArray(row?.mountpoints) ? row.mountpoints.filter((item) => typeof item === 'string').slice(0, 32) : text(row?.MountPoint) ? [text(row.MountPoint)] : [];
  return Object.freeze({
    device: text(row?.DeviceID ?? row?.device ?? row?.name ?? row?.Name),
    model: text(row?.Model ?? row?.FriendlyName ?? row?.model),
    serial: text(row?.SerialNumber ?? row?.serial),
    mediaType: mediaType(row),
    sizeBytes: number(row?.Size ?? row?.size),
    health: healthState(row?.HealthStatus ?? row?.health ?? row?.OperationalStatus),
    mountpoints: Object.freeze(mountpoints),
    platform,
    smart: 'unavailable'
  });
}

export function parseWindowsDriveHealth(output) {
  let parsed;
  try { parsed = JSON.parse(String(output || '')); } catch { return Object.freeze({ version: DRIVE_HEALTH_VERSION, platform: 'win32', available: false, drives: Object.freeze([]), source: 'Get-PhysicalDisk', reason: 'invalid JSON' }); }
  const drives = rows(parsed).map((row) => drive(row, 'win32')).filter((item) => item.device || item.model);
  return Object.freeze({ version: DRIVE_HEALTH_VERSION, platform: 'win32', available: drives.length > 0, drives: Object.freeze(drives), source: 'Get-PhysicalDisk' });
}

export function parseLinuxDriveHealth(output) {
  let parsed;
  try { parsed = JSON.parse(String(output || '')); } catch { return Object.freeze({ version: DRIVE_HEALTH_VERSION, platform: 'linux', available: false, drives: Object.freeze([]), source: 'lsblk', reason: 'invalid JSON' }); }
  const devices = Array.isArray(parsed?.blockdevices) ? parsed.blockdevices : [];
  const drives = devices.filter((row) => text(row?.type)?.toLowerCase() === 'disk').map((row) => drive(row, 'linux'));
  return Object.freeze({ version: DRIVE_HEALTH_VERSION, platform: 'linux', available: drives.length > 0, drives: Object.freeze(drives), source: 'lsblk' });
}

export function parseDarwinDriveHealth(output) {
  const devices = String(output || '').split(/\r?\n/).map((line) => line.match(/^\s*(\/dev\/disk\d+)\s*\(([^)]*)\)/i)).filter(Boolean).map((match) => ({ device: match[1], model: match[2], type: /physical/i.test(match[2]) ? 'hdd' : 'unknown' }));
  const drives = devices.map((row) => drive(row, 'darwin'));
  return Object.freeze({ version: DRIVE_HEALTH_VERSION, platform: 'darwin', available: drives.length > 0, drives: Object.freeze(drives), source: 'diskutil list' });
}

function commandAvailable(commandRunner) { return Boolean(commandRunner && typeof commandRunner.run === 'function'); }

export async function collectDriveHealth({ platform = process.platform, commandRunner } = {}) {
  if (!commandAvailable(commandRunner)) return Object.freeze({ version: DRIVE_HEALTH_VERSION, platform, available: false, drives: Object.freeze([]), source: 'unavailable', reason: 'command runner unavailable' });
  const command = platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Get-PhysicalDisk | Select-Object FriendlyName,SerialNumber,MediaType,Size,HealthStatus,OperationalStatus | ConvertTo-Json -Compress'], { timeoutMs: 5000, maxOutputBytes: 16384 }]
    : platform === 'linux'
      ? ['lsblk', ['--json', '--bytes', '--nodeps', '--output', 'NAME,TYPE,SIZE,ROTA,MODEL,SERIAL,MOUNTPOINTS'], { timeoutMs: 2500, maxOutputBytes: 65536 }]
      : platform === 'darwin' ? ['diskutil', ['list'], { timeoutMs: 2500, maxOutputBytes: 16384 }] : null;
  if (!command) return Object.freeze({ version: DRIVE_HEALTH_VERSION, platform, available: false, drives: Object.freeze([]), source: 'unsupported', reason: 'platform unsupported' });
  try {
    const result = await commandRunner.run(command[0], command[1], command[2]);
    if (result?.code !== 0) throw new Error(result?.stderr || 'drive inventory command failed');
    const parsed = platform === 'win32' ? parseWindowsDriveHealth(result.stdout) : platform === 'linux' ? parseLinuxDriveHealth(result.stdout) : parseDarwinDriveHealth(result.stdout);
    return Object.freeze({ ...parsed, commandAvailable: true });
  } catch (error) {
    return Object.freeze({ version: DRIVE_HEALTH_VERSION, platform, available: false, drives: Object.freeze([]), source: 'unavailable', reason: error.message });
  }
}

function lastNumber(value) {
  const matches = String(value || '').match(/\b\d+(?:\.\d+)?\b/g) || [];
  const parsed = Number(matches.at(-1));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function lineWith(source, pattern) { return source.split(/\r?\n/).find((line) => pattern.test(line)) || ''; }

export function parseSmartOutput(output) {
  const source = String(output || '');
  const temperature = lastNumber(lineWith(source, /(?:Temperature_Celsius|Airflow_Temperature_Cel|Temperature:)/i));
  const usedMatch = source.match(/Percentage Used:\s*(\d+(?:\.\d+)?)\s*%/i);
  const remainingLine = lineWith(source, /Percent_Lifetime_Remain/i);
  const percentageUsed = usedMatch ? Number(usedMatch[1]) : remainingLine ? Math.max(0, 100 - (lastNumber(remainingLine) ?? 100)) : null;
  const powerOnHours = lastNumber(lineWith(source, /Power_On_Hours|Power On Hours/i));
  const unsafeShutdowns = lastNumber(lineWith(source, /Unsafe_Shutdowns|Unsafe Shutdowns/i));
  const criticalWarning = source.match(/Critical Warning:\s*(\S+)/i)?.[1] || null;
  return Object.freeze({ temperatureC: temperature, percentageUsed, powerOnHours, unsafeShutdowns, criticalWarning });
}

function validDevice(device, platform) {
  const value = text(device);
  if (!value || value.includes('..')) return false;
  return platform === 'win32' ? /^\\\\\.\\PhysicalDrive\d+$/.test(value) : /^\/dev\/[A-Za-z0-9._-]+$/.test(value);
}

export async function collectSmartHealth(device, { platform = process.platform, commandRunner } = {}) {
  if (!validDevice(device, platform)) return Object.freeze({ available: false, device: null, health: 'unknown', reason: 'device path is not approved' });
  if (!commandAvailable(commandRunner)) return Object.freeze({ available: false, device, health: 'unknown', reason: 'command runner unavailable' });
  try {
    const result = await commandRunner.run('smartctl', ['-H', '-A', device], { timeoutMs: 5000, maxOutputBytes: 16384 });
    const output = `${result?.stdout || ''}\n${result?.stderr || ''}`;
    const passed = /SMART overall-health self-assessment test result:\s*PASSED/i.test(output) || /SMART Health Status:\s*OK/i.test(output);
    const failed = /SMART overall-health self-assessment test result:\s*(FAILED|UNKNOWN)/i.test(output) || /SMART Health Status:\s*(FAILED|UNKNOWN)/i.test(output);
    return Object.freeze({ available: result?.code === 0 || passed || failed, device, health: passed ? 'healthy' : failed ? 'failed' : 'unknown', exitCode: Number.isInteger(result?.code) ? result.code : null, source: 'smartctl', ...parseSmartOutput(output) });
  } catch (error) { return Object.freeze({ available: false, device, health: 'unknown', reason: error.message }); }
}

