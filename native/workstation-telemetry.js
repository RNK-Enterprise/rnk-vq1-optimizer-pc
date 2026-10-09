/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded cross-platform workstation telemetry. Every command is fixed in
 * this module; callers receive observations only and no process or file
 * authority is granted by the returned facts.
 */

import fs from 'fs/promises';
import { collectStartupTelemetry } from './startup-telemetry.js';
import { collectNetworkConnectionTelemetry } from './network-connections.js';

export const WORKSTATION_TELEMETRY_VERSION = 1;
const EMPTY = Object.freeze([]);
const INFERRED_PROCESS_ROLES = new Map([
  ['codex', 'developer'], ['opencode', 'developer'], ['node', 'developer'],
  ['nodejs', 'developer'], ['python', 'developer'], ['python3', 'developer'],
  ['git', 'developer'], ['code', 'developer'], ['code-insiders', 'developer'],
  ['devenv', 'developer'], ['msbuild', 'developer'], ['dotnet', 'developer'],
  ['cargo', 'developer'], ['rustc', 'developer'], ['cmake', 'developer'],
  ['make', 'developer'], ['ninja', 'developer'], ['wsl', 'runtime'],
  ['wslhost', 'runtime'], ['vmmem', 'runtime'], ['vmmemwsl', 'runtime'],
  ['ollama', 'model'], ['llama-server', 'model'], ['llama.cpp', 'model'],
  ['koboldcpp', 'model'], ['lmstudio', 'model'], ['comfyui', 'model']
]);
const WINDOWS_BATTERY_COMMAND = [
  '$basic=@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1);',
  '$static=@(Get-CimInstance -Namespace root/wmi -ClassName BatteryStaticData -ErrorAction SilentlyContinue | Select-Object -First 1);',
  '$full=@(Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue | Select-Object -First 1);',
  '$cycle=@(Get-CimInstance -Namespace root/wmi -ClassName BatteryCycleCount -ErrorAction SilentlyContinue | Select-Object -First 1);',
  '$designed=$null;if($static.Count){$designed=$static[0].DesignedCapacity};',
  '$charged=$null;if($full.Count){$charged=$full[0].FullChargedCapacity};',
  '$cycles=$null;if($cycle.Count){$cycles=$cycle[0].CycleCount};',
  '$name="battery";$status="unknown";$charge=$null;if($basic.Count){$name=$basic[0].Name;$status=$basic[0].Status;$charge=$basic[0].EstimatedChargeRemaining};',
  '$row=[pscustomobject]@{Name=$name;Status=$status;EstimatedChargeRemaining=$charge;DesignedCapacity=$designed;FullChargeCapacity=$charged;CycleCount=$cycles};',
  '$row | ConvertTo-Json -Compress'
].join('');

function number(value) { const parsed = typeof value === 'string' && value.trim() ? Number(value) : value; return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function json(output) { try { return JSON.parse(String(output || '')); } catch { return null; } }
function rows(value) { return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []; }
function commandAvailable(commandRunner) { return Boolean(commandRunner && typeof commandRunner.run === 'function'); }

function normalizedPath(value) {
  const path = text(value);
  return path ? path.replaceAll('\\', '/').toLowerCase() : null;
}

function trustedGamePath(value) {
  const path = normalizedPath(value);
  return Boolean(path && path.includes('/steamapps/common/'));
}

function inferredRole(name, executablePath) {
  if (trustedGamePath(executablePath)) return 'game';
  const normalized = String(name).trim().toLowerCase().replace(/\.exe$/, '');
  return INFERRED_PROCESS_ROLES.get(normalized) || null;
}

function normalizeProcess(row, platform) {
  const pid = number(row?.pid ?? row?.Id);
  if (!Number.isInteger(pid) || pid < 1) return null;
  const name = text(row?.name ?? row?.ProcessName ?? row?.comm) || 'unknown';
  const executablePath = text(row?.path ?? row?.Path ?? row?.exePath);
  const explicitRole = text(row?.role)?.toLowerCase();
  const cpu = number(row?.cpuPercent);
  const cpuSeconds = number(row?.CPU ?? row?.cpuSeconds);
  const memoryBytes = number(row?.memoryBytes ?? row?.WorkingSet64) ?? (number(row?.rssKb) === null ? null : number(row.rssKb) * 1024);
  return Object.freeze({
    pid,
    name,
    path: executablePath,
    cpuPercent: cpu,
    cpuSeconds,
    memoryBytes,
    uptimeSeconds: number(row?.uptimeSeconds),
    state: text(row?.state ?? row?.State) || 'unknown',
    platform,
    foreground: row?.foreground === true,
    protected: row?.protected === true,
    role: explicitRole && explicitRole !== 'unknown' ? explicitRole : inferredRole(name, executablePath) || 'unknown'
  });
}

function parsePosixProcessLine(line, platform) {
  const fields = String(line).trim().split(/\s+/);
  if (fields.length < 6) return null;
  const [pid, name, cpuPercent, rssKb, elapsed, state] = fields;
  return normalizeProcess({ pid, name, cpuPercent, rssKb, uptimeSeconds: elapsedSeconds(elapsed), state }, platform);
}

function elapsedSeconds(value) {
  const parts = String(value).split('-');
  const clock = parts.pop()?.split(':').map(Number);
  if (!clock?.length || clock.some((item) => !Number.isFinite(item))) return null;
  const seconds = clock.pop();
  const minutes = clock.pop() || 0;
  const hours = clock.pop() || 0;
  const days = parts.length ? Number(parts[0]) : 0;
  return Number.isFinite(days) && days >= 0 ? (((days * 24 + hours) * 60 + minutes) * 60) + seconds : null;
}

export function parseProcessTelemetry(output, { platform = 'unknown' } = {}) {
  if (platform === 'win32') {
    const parsed = json(output);
    const processes = rows(parsed).map((row) => normalizeProcess(row, platform)).filter(Boolean).slice(0, 512);
    return Object.freeze({ available: processes.length > 0, processes: Object.freeze(processes), truncated: rows(parsed).length > 512 });
  }
  const lines = String(output || '').split(/\r?\n/).filter((line) => line.trim());
  const processes = lines.map((line) => parsePosixProcessLine(line, platform)).filter(Boolean).slice(0, 512);
  return Object.freeze({ available: processes.length > 0, processes: Object.freeze(processes), truncated: lines.length > 512 });
}

async function enrichLinuxProcessPaths(telemetry, fsImpl) {
  if (typeof fsImpl?.readlink !== 'function' || telemetry.processes.length === 0) return telemetry;
  const processes = await Promise.all(telemetry.processes.map(async (process) => {
    try {
      const path = await fsImpl.readlink(`/proc/${process.pid}/exe`);
      const role = process.role === 'unknown' ? inferredRole(process.name, path) || 'unknown' : process.role;
      return Object.freeze({ ...process, path: text(path), role });
    } catch {
      return process;
    }
  }));
  return Object.freeze({ ...telemetry, processes: Object.freeze(processes) });
}

export async function collectProcessTelemetry({ platform = process.platform, commandRunner, fsImpl = fs } = {}) {
  if (!commandAvailable(commandRunner)) return Object.freeze({ available: false, processes: EMPTY, truncated: false, reason: 'command runner unavailable' });
  const command = platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', "$signature='[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);'; Add-Type -MemberDefinition $signature -Name ForegroundWindow -Namespace RnkNative -ErrorAction Stop; $window=[RnkNative.ForegroundWindow]::GetForegroundWindow(); [uint32]$foregroundPid=0; [void][RnkNative.ForegroundWindow]::GetWindowThreadProcessId($window,[ref]$foregroundPid); Get-Process | ForEach-Object { $cpu=$null; $start=$null; $path=$null; try { $cpu=$_.CPU } catch {}; try { $start=$_.StartTime } catch {}; try { $path=$_.Path } catch {}; [pscustomobject]@{ Id=$_.Id; ProcessName=$_.ProcessName; Path=$path; WorkingSet64=$_.WorkingSet64; CPU=$cpu; StartTime=$start; foreground=($_.Id -eq $foregroundPid) } } | ConvertTo-Json -Compress"], { timeoutMs: 5000, maxOutputBytes: 65536 }]
    : platform === 'linux' || platform === 'darwin'
      ? ['ps', ['-eo', 'pid=,comm=,pcpu=,rss=,etime=,state='], { timeoutMs: 2500, maxOutputBytes: 65536 }]
      : null;
  if (!command) return Object.freeze({ available: false, processes: EMPTY, truncated: false, reason: 'platform unsupported' });
  try {
    const result = await commandRunner.run(command[0], command[1], command[2]);
    if (result?.code !== 0) return Object.freeze({ available: false, processes: EMPTY, truncated: false, reason: result?.stderr || 'process command failed' });
    const telemetry = parseProcessTelemetry(result.stdout, { platform });
    return platform === 'linux' ? enrichLinuxProcessPaths(telemetry, fsImpl) : telemetry;
  } catch (error) {
    return Object.freeze({ available: false, processes: EMPTY, truncated: false, reason: error.message });
  }
}

function normalizeBattery(row, platform) {
  const design = number(row?.designCapacity ?? row?.DesignCapacity ?? row?.DesignedCapacity ?? row?.energyFullDesign);
  const full = number(row?.fullCapacity ?? row?.FullChargeCapacity ?? row?.energyFull);
  const capacity = number(row?.capacity ?? row?.EstimatedChargeRemaining);
  return Object.freeze({
    platform,
    name: text(row?.name ?? row?.Name) || 'battery',
    status: text(row?.status ?? row?.Status) || 'unknown',
    capacityPercent: capacity === null ? null : Math.min(100, capacity),
    healthPercent: design && full !== null ? Math.min(100, (full / design) * 100) : null,
    designCapacity: design,
    fullCapacity: full,
    cycleCount: number(row?.cycleCount ?? row?.CycleCount)
  });
}

export function parseBatteryTelemetry(output, { platform = 'unknown' } = {}) {
  if (platform === 'darwin') {
    const match = String(output || '').match(/(\d+)%/);
    return Object.freeze({ available: Boolean(match), batteries: Object.freeze([normalizeBattery({ capacity: match?.[1], status: /charging/i.test(String(output)) ? 'charging' : 'discharging' }, platform)]).filter((item) => item.capacityPercent !== null), source: 'pmset' });
  }
  const parsed = json(output);
  const batteries = rows(parsed).map((row) => normalizeBattery(row, platform));
  return Object.freeze({ available: batteries.length > 0, batteries: Object.freeze(batteries), source: platform === 'win32' ? 'win32-battery' : 'unknown' });
}

async function collectLinuxBatteries(fsImpl) {
  let names;
  try { names = await fsImpl.readdir('/sys/class/power_supply'); } catch { return Object.freeze({ available: false, batteries: EMPTY, source: 'sysfs' }); }
  const batteries = [];
  for (const name of names.filter((item) => /^BAT/i.test(item)).slice(0, 8)) {
    const read = async (file) => { try { return (await fsImpl.readFile(`/sys/class/power_supply/${name}/${file}`, 'utf8')).trim(); } catch { return null; } };
    const type = await read('type');
    if (type && type.toLowerCase() !== 'battery') continue;
    batteries.push(normalizeBattery({ name, status: await read('status'), capacity: await read('capacity'), energyFull: await read('energy_full'), energyFullDesign: await read('energy_full_design'), cycleCount: await read('cycle_count') }, 'linux'));
  }
  return Object.freeze({ available: batteries.length > 0, batteries: Object.freeze(batteries), source: 'sysfs' });
}

export async function collectBatteryTelemetry({ platform = process.platform, commandRunner, fsImpl = fs } = {}) {
  if (platform === 'linux') return collectLinuxBatteries(fsImpl);
  if (!commandAvailable(commandRunner)) return Object.freeze({ available: false, batteries: EMPTY, source: 'command runner unavailable' });
  const command = platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_BATTERY_COMMAND], { timeoutMs: 5000, maxOutputBytes: 8192 }]
    : platform === 'darwin' ? ['pmset', ['-g', 'batt'], { timeoutMs: 2500, maxOutputBytes: 8192 }] : null;
  if (!command) return Object.freeze({ available: false, batteries: EMPTY, source: 'platform unsupported' });
  try {
    const result = await commandRunner.run(command[0], command[1], command[2]);
    if (result?.code !== 0) return Object.freeze({ available: false, batteries: EMPTY, source: result?.stderr || 'battery command failed' });
    return parseBatteryTelemetry(result.stdout, { platform });
  } catch (error) { return Object.freeze({ available: false, batteries: EMPTY, source: error.message }); }
}

function normalizeThermal(row, platform) {
  const raw = number(row?.temperatureC ?? row?.CurrentTemperature ?? row?.temp);
  let temperatureC = raw;
  if (row?.CurrentTemperature !== undefined) {
    if (raw !== null) temperatureC = (raw / 10) - 273.15;
  } else if (raw !== null && raw > 200) {
    temperatureC = raw / 1000;
  }
  return Object.freeze({ platform, name: text(row?.name ?? row?.InstanceName ?? row?.type) || 'thermal-zone', temperatureC: Number.isFinite(temperatureC) ? Math.round(temperatureC * 100) / 100 : null });
}

export function parseThermalTelemetry(output, { platform = 'unknown' } = {}) {
  const parsed = json(output);
  const rowsToNormalize = parsed ? rows(parsed) : String(output || '').split(/\r?\n/).map((line) => ({ temp: line.match(/(-?\d+(?:\.\d+)?)/)?.[1], name: line.split(':')[0] })).filter((row) => row.temp !== undefined);
  const zones = rowsToNormalize.map((row) => normalizeThermal(row, platform)).filter((row) => row.temperatureC !== null).slice(0, 64);
  return Object.freeze({ available: zones.length > 0, zones: Object.freeze(zones), maxTemperatureC: zones.length ? Math.max(...zones.map((row) => row.temperatureC)) : null });
}

async function collectLinuxThermals(fsImpl) {
  let names;
  try { names = await fsImpl.readdir('/sys/class/thermal'); } catch { return Object.freeze({ available: false, zones: EMPTY, maxTemperatureC: null, thermalThrottling: null, throttleEvents: null, source: 'sysfs' }); }
  const zones = [];
  for (const name of names.filter((item) => /^thermal_zone\d+$/.test(item)).slice(0, 32)) {
    try { const temp = await fsImpl.readFile(`/sys/class/thermal/${name}/temp`, 'utf8'); const type = await fsImpl.readFile(`/sys/class/thermal/${name}/type`, 'utf8'); zones.push(normalizeThermal({ name: type.trim(), temp }, 'linux')); } catch { /* unavailable zone */ }
  }
  const valid = zones.filter((row) => row.temperatureC !== null);
  const throttle = await collectLinuxThrottleCounters(fsImpl);
  return Object.freeze({ available: valid.length > 0, zones: Object.freeze(valid), maxTemperatureC: valid.length ? Math.max(...valid.map((row) => row.temperatureC)) : null, ...throttle, source: 'sysfs' });
}

async function collectLinuxThrottleCounters(fsImpl) {
  let names;
  try { names = await fsImpl.readdir('/sys/devices/system/cpu'); } catch { return { thermalThrottling: null, throttleEvents: null }; }
  const cpuNames = names.filter((item) => /^cpu\d+$/.test(item)).slice(0, 256);
  const counts = [];
  for (const name of cpuNames) {
    for (const file of ['package_throttle_count', 'core_throttle_count']) {
      try {
        const value = number(await fsImpl.readFile(`/sys/devices/system/cpu/${name}/thermal_throttle/${file}`, 'utf8'));
        if (value !== null) counts.push(value);
      } catch { /* unavailable counter */ }
    }
  }
  if (!counts.length) return { thermalThrottling: null, throttleEvents: null };
  const throttleEvents = counts.reduce((sum, value) => sum + value, 0);
  return { thermalThrottling: throttleEvents > 0, throttleEvents };
}

export async function collectThermalTelemetry({ platform = process.platform, commandRunner, fsImpl = fs } = {}) {
  if (platform === 'linux') return collectLinuxThermals(fsImpl);
  if (!commandAvailable(commandRunner)) return Object.freeze({ available: false, zones: EMPTY, maxTemperatureC: null, source: 'command runner unavailable' });
  const command = platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Get-CimInstance MSAcpi_ThermalZoneTemperature | Select-Object InstanceName,CurrentTemperature | ConvertTo-Json -Compress'], { timeoutMs: 5000, maxOutputBytes: 8192 }]
    : null;
  if (!command) return Object.freeze({ available: false, zones: EMPTY, maxTemperatureC: null, source: 'platform unsupported' });
  try {
    const result = await commandRunner.run(command[0], command[1], command[2]);
    if (result?.code !== 0) return Object.freeze({ available: false, zones: EMPTY, maxTemperatureC: null, source: result?.stderr || 'thermal command failed' });
    return { ...parseThermalTelemetry(result.stdout, { platform }), source: 'MSAcpi_ThermalZoneTemperature' };
  } catch (error) { return Object.freeze({ available: false, zones: EMPTY, maxTemperatureC: null, source: error.message }); }
}

export function parseNetworkTelemetry(output, { platform = 'unknown' } = {}) {
  if (platform === 'win32') {
    const parsed = json(output);
    const interfaces = rows(parsed).map((row) => Object.freeze({ name: text(row?.Name) || 'unknown', receivedBytes: number(row?.ReceivedBytes), sentBytes: number(row?.SentBytes), state: text(row?.State) || 'unknown' }));
    return Object.freeze({ available: interfaces.length > 0, interfaces: Object.freeze(interfaces), source: 'Get-NetAdapterStatistics' });
  }
  if (platform === 'linux') {
    const interfaces = String(output || '').split(/\r?\n/).map((line) => { const [name, values] = line.split(':'); const fields = values?.trim().split(/\s+/); return fields?.length >= 9 ? Object.freeze({ name: name.trim(), receivedBytes: number(fields[0]), sentBytes: number(fields[8]), state: 'observed' }) : null; }).filter(Boolean);
    return Object.freeze({ available: interfaces.length > 0, interfaces: Object.freeze(interfaces), source: '/proc/net/dev' });
  }
  const interfaces = String(output || '').split(/\r?\n/).filter((line) => line.trim() && !/^name\s/i.test(line)).map((line) => Object.freeze({ name: line.trim().split(/\s+/)[0], receivedBytes: null, sentBytes: null, state: 'observed' }));
  return Object.freeze({ available: interfaces.length > 0, interfaces: Object.freeze(interfaces), source: 'netstat' });
}

export async function collectNetworkTelemetry({ platform = process.platform, commandRunner, fsImpl = fs } = {}) {
  if (platform === 'linux') {
    try { return parseNetworkTelemetry(await fsImpl.readFile('/proc/net/dev', 'utf8'), { platform }); } catch { return Object.freeze({ available: false, interfaces: EMPTY, source: 'proc unavailable' }); }
  }
  if (!commandAvailable(commandRunner)) return Object.freeze({ available: false, interfaces: EMPTY, source: 'command runner unavailable' });
  const command = platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress'], { timeoutMs: 5000, maxOutputBytes: 16384 }]
    : platform === 'darwin' ? ['netstat', ['-ib'], { timeoutMs: 2500, maxOutputBytes: 16384 }] : null;
  if (!command) return Object.freeze({ available: false, interfaces: EMPTY, source: 'platform unsupported' });
  try { const result = await commandRunner.run(command[0], command[1], command[2]); return result?.code === 0 ? parseNetworkTelemetry(result.stdout, { platform }) : Object.freeze({ available: false, interfaces: EMPTY, source: result?.stderr || 'network command failed' }); } catch (error) { return Object.freeze({ available: false, interfaces: EMPTY, source: error.message }); }
}

export async function collectWorkstationTelemetry({ platform = process.platform, commandRunner, fsImpl = fs, env = process.env } = {}) {
  const [processes, battery, thermals, network, networkConnections, startup] = await Promise.all([
    collectProcessTelemetry({ platform, commandRunner }),
    collectBatteryTelemetry({ platform, commandRunner, fsImpl }),
    collectThermalTelemetry({ platform, commandRunner, fsImpl }),
    collectNetworkTelemetry({ platform, commandRunner, fsImpl }),
    collectNetworkConnectionTelemetry({ platform, commandRunner }),
    collectStartupTelemetry({ platform, commandRunner, env, fsImpl })
  ]);
  return Object.freeze({ telemetryVersion: WORKSTATION_TELEMETRY_VERSION, platform, processes, battery, thermals, network, networkConnections, startup });
}
