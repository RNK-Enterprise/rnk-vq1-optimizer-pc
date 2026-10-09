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
  const diskNumber = platform === 'win32' && Number.isInteger(Number(row?.DiskNumber ?? row?.Number ?? row?.Index)) && Number(row?.DiskNumber ?? row?.Number ?? row?.Index) >= 0 ? Number(row?.DiskNumber ?? row?.Number ?? row?.Index) : null;
  const device = text(row?.DeviceID ?? row?.device ?? row?.name ?? row?.Name) || (diskNumber === null ? null : `PhysicalDrive${diskNumber}`);
  const physicalDevicePath = platform === 'win32' ? smartDeviceFor(device, platform) : null;
  return Object.freeze({
    device,
    diskNumber,
    physicalDevicePath,
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

export function parseDarwinDriveInfo(output, base) {
  const source = String(output || '');
  const solidState = source.match(/<key>SolidState<\/key>\s*<(true|false)\s*\/>/i)?.[1]?.toLowerCase() || null;
  const model = source.match(/<key>MediaName<\/key>\s*<string>([^<]*)<\/string>/i)?.[1] || base?.model || null;
  const sizeMatch = source.match(/<key>TotalSize<\/key>\s*<integer>(\d+)<\/integer>/i);
  const mediaType = solidState === 'true' ? 'ssd' : solidState === 'false' ? 'hdd' : base?.mediaType || 'unknown';
  return Object.freeze({ ...base, model: text(model), sizeBytes: sizeMatch ? number(sizeMatch[1]) : base?.sizeBytes ?? null, mediaType });
}

async function enrichDarwinDrives(parsed, commandRunner) {
  const drives = await Promise.all(parsed.drives.slice(0, 32).map(async (base) => {
    try {
      const result = await commandRunner.run('diskutil', ['info', '-plist', base.device], { timeoutMs: 2500, maxOutputBytes: 16384 });
      return result?.code === 0 ? parseDarwinDriveInfo(result.stdout, base) : base;
    } catch {
      return base;
    }
  }));
  return Object.freeze({ ...parsed, drives: Object.freeze(drives) });
}

function commandAvailable(commandRunner) { return Boolean(commandRunner && typeof commandRunner.run === 'function'); }

export async function collectDriveHealth({ platform = process.platform, commandRunner } = {}) {
  if (!commandAvailable(commandRunner)) return Object.freeze({ version: DRIVE_HEALTH_VERSION, platform, available: false, drives: Object.freeze([]), source: 'unavailable', reason: 'command runner unavailable' });
  const command = platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', "$physical = @(Get-PhysicalDisk); $disks = @(Get-Disk); $rows = foreach ($disk in $disks) { $match = $physical | Where-Object { $_.SerialNumber -and $disk.SerialNumber -and $_.SerialNumber.Trim() -eq $disk.SerialNumber.Trim() } | Select-Object -First 1; [pscustomobject]@{ DeviceID = ('PhysicalDrive{0}' -f $disk.Number); DiskNumber = [int]$disk.Number; FriendlyName = if ($match) { $match.FriendlyName } else { $disk.FriendlyName }; SerialNumber = $disk.SerialNumber; MediaType = if ($match) { $match.MediaType } else { 'Unspecified' }; Size = [int64]$disk.Size; HealthStatus = $disk.HealthStatus; OperationalStatus = $disk.OperationalStatus } }; @($rows) | ConvertTo-Json -Compress"], { timeoutMs: 5000, maxOutputBytes: 16384 }]
    : platform === 'linux'
      ? ['lsblk', ['--json', '--bytes', '--nodeps', '--output', 'NAME,TYPE,SIZE,ROTA,MODEL,SERIAL,MOUNTPOINTS'], { timeoutMs: 2500, maxOutputBytes: 65536 }]
      : platform === 'darwin' ? ['diskutil', ['list'], { timeoutMs: 2500, maxOutputBytes: 16384 }] : null;
  if (!command) return Object.freeze({ version: DRIVE_HEALTH_VERSION, platform, available: false, drives: Object.freeze([]), source: 'unsupported', reason: 'platform unsupported' });
  try {
    const result = await commandRunner.run(command[0], command[1], command[2]);
    if (result?.code !== 0) throw new Error(result?.stderr || 'drive inventory command failed');
    const parsed = platform === 'win32' ? parseWindowsDriveHealth(result.stdout) : platform === 'linux' ? parseLinuxDriveHealth(result.stdout) : parseDarwinDriveHealth(result.stdout);
    const enriched = platform === 'darwin' && parsed.available ? await enrichDarwinDrives(parsed, commandRunner) : parsed;
    return Object.freeze({ ...enriched, commandAvailable: true });
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
    const available = passed || failed;
    return Object.freeze({ available, device, health: passed ? 'healthy' : failed ? 'failed' : 'unknown', reason: available ? null : 'SMART_UNAVAILABLE', exitCode: Number.isInteger(result?.code) ? result.code : null, source: 'smartctl', ...parseSmartOutput(output) });
  } catch (error) { return Object.freeze({ available: false, device, health: 'unknown', reason: error.message }); }
}

function smartDeviceFor(value, platform) {
  const device = text(value);
  if (!device) return null;
  if (platform === 'win32') {
    if (/^\\\\\.\\PhysicalDrive\d+$/.test(device)) return device;
    return /^PhysicalDrive\d+$/.test(device) ? `\\\\.\\${device}` : null;
  }
  if (!['linux', 'darwin'].includes(platform)) return null;
  if (/^\/dev\/[A-Za-z0-9._-]+$/.test(device)) return device;
  return /^[A-Za-z0-9._-]+$/.test(device) ? `/dev/${device}` : null;
}

export async function collectSmartHealthForDrives(drives = [], { platform = process.platform, commandRunner, maxDrives = 32 } = {}) {
  if (!Array.isArray(drives)) throw new TypeError('SMART drive inventory must be an array');
  if (!Number.isInteger(maxDrives) || maxDrives < 1 || maxDrives > 32) throw new RangeError('SMART drive limit is out of range');
  const unresolved = [];
  const devices = [...new Set(drives.slice(0, maxDrives).map((item) => {
    const raw = item?.physicalDevicePath ?? item?.device ?? (Number.isInteger(item?.diskNumber) && item.diskNumber >= 0 ? `PhysicalDrive${item.diskNumber}` : null);
    const device = smartDeviceFor(raw, platform);
    if (!device && platform === 'win32' && item && item.device == null && item.physicalDevicePath == null && item.diskNumber == null) unresolved.push(Object.freeze({ available: false, device: null, health: 'unknown', state: 'SMART_DEVICE_UNRESOLVED', reason: 'SMART_DEVICE_UNRESOLVED' }));
    return device;
  }).filter(Boolean))];
  const results = await Promise.all(devices.map((device) => collectSmartHealth(device, { platform, commandRunner })));
  return Object.freeze({ version: DRIVE_HEALTH_VERSION, platform, available: results.some((item) => item.available), observedCount: results.length, unresolvedCount: unresolved.length, results: Object.freeze([...unresolved, ...results]), source: 'smartctl' });
}
