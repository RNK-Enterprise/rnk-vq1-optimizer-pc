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
 * Windows native adapter. Only fixed, reviewable commands live here. Gateway
 * payloads never select an executable, argument, path, or process id.
 */

import { collectSystemFacts } from './system-facts.js';
import { MAX_RESOURCE_MEMORY_BYTES, MIN_RESOURCE_MEMORY_BYTES } from './protocol.js';
import { collectWindowsRogFacts } from './windows-rog.js';
import { applyWindowsTrafficShape, collectWindowsNetworkCounters } from './windows-network.js';

const POWER_GUIDS = Object.freeze({
  balanced: '381b4222-f694-41f0-9685-ff5bb260df2e',
  performance: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  battery: 'a1841308-3541-4fab-bc81-f71556f20b4a'
});

const PRIORITY_CLASSES = Object.freeze({ low: 'BelowNormal', normal: 'Normal', high: 'AboveNormal' });
const RESOURCE_LIMIT_SCRIPT = [
  '$source = @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class RnkResourceJob {',
  '[StructLayout(LayoutKind.Sequential)] public struct Basic { public long ProcessTime; public long JobTime; public uint Flags; public UIntPtr Min; public UIntPtr Max; public uint Active; public UIntPtr Affinity; public uint Priority; public uint Scheduling; }',
  '[StructLayout(LayoutKind.Sequential)] public struct Io { public ulong ReadOps; public ulong WriteOps; public ulong OtherOps; public ulong ReadBytes; public ulong WriteBytes; public ulong OtherBytes; }',
  '[StructLayout(LayoutKind.Sequential)] public struct Extended { public Basic BasicInfo; public Io IoInfo; public UIntPtr ProcessMemory; public UIntPtr JobMemory; public UIntPtr PeakProcess; public UIntPtr PeakJob; }',
  '[StructLayout(LayoutKind.Sequential)] public struct CpuRate { public uint Flags; public uint Rate; }',
  '[DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a, string n);',
  '[DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenJobObject(uint access, bool inherit, string n);',
  '[DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);',
  '[DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);',
  '[DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);',
  '[DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint length);',
  '[DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr info, uint length, out uint returned);',
  '[DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);',
  'const uint JobAccess = 0x1F001F; const uint ProcessAccess = 0x1500;',
  'public static string Name(int pid) { return "Local\\\\RNK-Optimizer-" + pid; }',
  'static IntPtr OpenOrCreate(string name) { IntPtr job = OpenJobObject(JobAccess, false, name); return job == IntPtr.Zero ? CreateJobObject(IntPtr.Zero, name) : job; }',
  'static int SetMemory(IntPtr job, long memory) { var info = new Extended(); info.BasicInfo.Flags = 0x100; info.ProcessMemory = (UIntPtr)(ulong)memory; IntPtr ptr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Extended))); try { Marshal.StructureToPtr(info, ptr, false); return SetInformationJobObject(job, 9, ptr, (uint)Marshal.SizeOf(typeof(Extended))) ? 0 : Marshal.GetLastWin32Error(); } finally { Marshal.FreeHGlobal(ptr); } }',
  'static int SetCpu(IntPtr job, int cpu) { var info = new CpuRate { Flags = 1, Rate = (uint)(cpu * 100) }; IntPtr ptr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(CpuRate))); try { Marshal.StructureToPtr(info, ptr, false); return SetInformationJobObject(job, 15, ptr, (uint)Marshal.SizeOf(typeof(CpuRate))) ? 0 : Marshal.GetLastWin32Error(); } finally { Marshal.FreeHGlobal(ptr); } }',
  'public static int Apply(int pid, long memory, int cpu) { if (memory <= 0 && cpu <= 0) return 87; string name = Name(pid); IntPtr job = OpenOrCreate(name); if (job == IntPtr.Zero) return Marshal.GetLastWin32Error(); IntPtr process = OpenProcess(ProcessAccess, false, (uint)pid); if (process == IntPtr.Zero) { int e = Marshal.GetLastWin32Error(); CloseHandle(job); return e; } try { int result = memory > 0 ? SetMemory(job, memory) : 0; if (result != 0) return result; result = cpu > 0 ? SetCpu(job, cpu) : 0; if (result != 0) return result; bool inJob; if (!IsProcessInJob(process, job, out inJob)) return Marshal.GetLastWin32Error(); if (!inJob && !AssignProcessToJobObject(job, process)) return Marshal.GetLastWin32Error(); IntPtr verify = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Extended))); try { uint returned; if (!QueryInformationJobObject(job, 9, verify, (uint)Marshal.SizeOf(typeof(Extended)), out returned)) return Marshal.GetLastWin32Error(); } finally { Marshal.FreeHGlobal(verify); } return 0; } finally { CloseHandle(process); CloseHandle(job); } }',
  'public static string Query(int pid) { IntPtr job = OpenJobObject(JobAccess, false, Name(pid)); if (job == IntPtr.Zero) return null; IntPtr info = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Extended))); IntPtr cpuInfo = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(CpuRate))); try { uint returned; if (!QueryInformationJobObject(job, 9, info, (uint)Marshal.SizeOf(typeof(Extended)), out returned)) return null; var extended = Marshal.PtrToStructure<Extended>(info); var cpuPercent = 0; if (QueryInformationJobObject(job, 15, cpuInfo, (uint)Marshal.SizeOf(typeof(CpuRate)), out returned)) cpuPercent = (int)(Marshal.PtrToStructure<CpuRate>(cpuInfo).Rate / 100); return "{\\"memoryBytes\\":" + extended.ProcessMemory.ToUInt64() + ",\\"cpuPercent\\":" + cpuPercent + "}"; } finally { Marshal.FreeHGlobal(info); Marshal.FreeHGlobal(cpuInfo); CloseHandle(job); } }',
  'public static int Release(int pid) { IntPtr job = OpenJobObject(JobAccess, false, Name(pid)); if (job == IntPtr.Zero) return Marshal.GetLastWin32Error(); IntPtr process = OpenProcess(ProcessAccess, false, (uint)pid); try { if (process != IntPtr.Zero) { bool inJob; if (IsProcessInJob(process, job, out inJob) && inJob) return 170; } return 0; } finally { if (process != IntPtr.Zero) CloseHandle(process); CloseHandle(job); } }',
  '} }',
  '"@;',
  'Add-Type -TypeDefinition $source -ErrorAction Stop;',
  '$operation = [string]$args[0]; $pidValue = [Int32]$args[1]; $memory = 0; $cpu = 0;',
  'if ($operation -eq "apply") { if ($args[3] -eq "memory-bytes") { $memory = [Int64]$args[2] } else { $cpu = [Int32]$args[2] }; $result = [RnkResourceJob]::Apply($pidValue, $memory, $cpu); $payload = if ($result -eq 0) { [RnkResourceJob]::Query($pidValue) } else { $null } } elseif ($operation -eq "query") { $payload = [RnkResourceJob]::Query($pidValue); $result = if ($null -eq $payload) { 2 } else { 0 } } elseif ($operation -eq "release") { $result = [RnkResourceJob]::Release($pidValue); $payload = $null } else { $result = 87; $payload = $null }',
  'if ($result -ne 0) { exit $result }; $facts = @{ operation=$operation; managedId=[RnkResourceJob]::Name($pidValue); scope="named-job-object"; verified=$true }; if ($payload) { $facts.limits = $payload | ConvertFrom-Json }; $facts | ConvertTo-Json -Compress'
].join('\n');

function resultFromCommand(result, operation) {
  if (result?.code === 0) return { ok: true, operation };
  return { ok: false, operation, reason: result?.stderr || `${operation} failed` };
}

function validPid(pid) {
  return Number.isInteger(pid) && pid > 0 && pid <= 2147483647;
}

function resourceAuthorityId(pid) { return `Local\\RNK-Optimizer-${pid}`; }

function validResourceLimit(action) {
  return action && ['cpu-percent', 'memory-bytes'].includes(action.value)
    && Number.isInteger(action.limit) && action.limit > 0
    && (action.value !== 'cpu-percent' || action.limit <= 100)
    && (action.value !== 'memory-bytes' || (action.limit >= MIN_RESOURCE_MEMORY_BYTES && action.limit <= MAX_RESOURCE_MEMORY_BYTES));
}

function validGpuPowerLimit(value) { return Number.isFinite(value) && value >= 10 && value <= 2000; }

export function windowsResourceLimitCommands() {
  return Object.freeze({ script: RESOURCE_LIMIT_SCRIPT, scope: 'named-job-object', lifecycle: Object.freeze(['create-or-open', 'identify', 'query', 'update', 'release', 'verify']) });
}

function resourceFacts(output) { try { const parsed = JSON.parse(String(output || '')); return parsed && typeof parsed === 'object' ? parsed : null; } catch { return null; } }

async function resourceAuthorityOperation(operation, processId, { commandRunner } = {}) {
  if (!validPid(processId)) return Object.freeze({ state: 'rejected', verified: false, operation, reason: 'resource authority requires a valid process id' });
  if (!commandRunner || typeof commandRunner.run !== 'function') return Object.freeze({ state: 'unavailable', verified: false, operation, managedId: resourceAuthorityId(processId), reason: 'command runner unavailable' });
  try {
    const result = await commandRunner.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', RESOURCE_LIMIT_SCRIPT, '--', operation, String(processId), '0', 'cpu-percent'], { timeoutMs: 10000, maxOutputBytes: 8192 });
    const facts = resourceFacts(result?.stdout);
    return Object.freeze(result?.code === 0
      ? { state: operation === 'release' ? 'released' : 'observed', verified: true, operation, managedId: resourceAuthorityId(processId), scope: 'named-job-object', limits: operation === 'query' ? facts?.limits || null : null }
      : result?.code === 170 && operation === 'release'
        ? { state: 'restart-required', verified: false, operation, managedId: resourceAuthorityId(processId), scope: 'named-job-object', reason: 'RESTART_REQUIRED_TO_RELAX_LIMIT' }
      : { state: 'rejected', verified: false, operation, managedId: resourceAuthorityId(processId), reason: result?.stderr || `Windows resource authority ${operation} failed` });
  } catch (error) {
    return Object.freeze({ state: 'rejected', verified: false, operation, managedId: resourceAuthorityId(processId), reason: error.message });
  }
}

export function queryWindowsResourceLimit(processId, options) { return resourceAuthorityOperation('query', processId, options); }
export function releaseWindowsResourceLimit(processId, options) { return resourceAuthorityOperation('release', processId, options); }

function approvedPid(context, pid) {
  const list = context?.approvedBackgroundPids;
  if (Array.isArray(list)) return list.includes(pid);
  if (list instanceof Set) return list.has(pid);
  return false;
}

export function createWindowsAdapter({ commandRunner, cacheCleaner, fpsController = null } = {}) {
  if (!commandRunner || typeof commandRunner.run !== 'function') throw new TypeError('Windows adapter requires a command runner');
  if (!cacheCleaner || typeof cacheCleaner.preview !== 'function' || typeof cacheCleaner.clean !== 'function') {
    throw new TypeError('Windows adapter requires a cache cleaner');
  }

  return {
    platform: 'win32',

    requiresAdmin(action) {
      return action.type === 'stop-approved-process'
        || action.type === 'set-process-affinity'
        || action.type === 'set-process-resource-limit'
        || action.type === 'set-process-network-limit'
        || action.type === 'set-fps-policy'
        || action.type === 'set-gpu-policy';
    },

    async collectFacts() {
      const facts = await collectSystemFacts({ platform: 'win32', commandRunner });
      facts.windows = { rog: await collectWindowsRogFacts({ commandRunner }) };
      facts.networkProcesses = await collectWindowsNetworkCounters({ commandRunner });
      return facts;
    },

    async applyAction(action, context = {}) {
      const pid = context.targetPid;
      switch (action.type) {
        case 'set-power-profile':
          return resultFromCommand(await commandRunner.run('powercfg.exe', ['/setactive', POWER_GUIDS[action.value]]), 'set-power-profile');
        case 'set-process-priority':
          if (!validPid(pid)) return { ok: false, reason: 'target process id is unavailable' };
          return resultFromCommand(await commandRunner.run('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
            '$p = Get-Process -Id ([int]$args[0]); $p.PriorityClass = $args[1]',
            '--', String(pid), PRIORITY_CLASSES[action.value]
          ]), 'set-process-priority');
        case 'set-process-affinity':
          if (!validPid(pid)) return { ok: false, reason: 'target process id is unavailable' };
          if (!['balanced', 'performance'].includes(action.value)) return { ok: false, reason: 'unsupported process affinity value' };
          return resultFromCommand(await commandRunner.run('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
            '$p = Get-Process -Id ([int]$args[0]); $count = [Environment]::ProcessorCount; [Int64]$mask = 0; for ($i = 0; $i -lt $count -and $i -lt 63; $i++) { if ($args[1] -eq "performance" -or $i % 2 -eq 0) { $mask = $mask -bor ([Int64]1 -shl $i) } }; $p.ProcessorAffinity = [IntPtr]$mask',
            '--', String(pid), action.value
          ]), 'set-process-affinity');
        case 'set-process-resource-limit':
          if (!validPid(pid)) return { ok: false, reason: 'target process id is unavailable' };
          if (action.value === 'io-bytes-per-second') return { ok: false, reason: 'I/O byte-rate limits are not supported by the Windows adapter' };
          if (!validResourceLimit(action)) return { ok: false, reason: 'resource limit value is invalid' };
          {
            const result = await commandRunner.run('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
            RESOURCE_LIMIT_SCRIPT, '--', 'apply', String(pid), String(action.limit), action.value
            ]);
            const outcome = resultFromCommand(result, 'set-process-resource-limit');
            return result?.code === 0 ? { ...outcome, mechanism: 'named-job-object', managedId: resourceAuthorityId(pid), scope: 'process-job', verified: true } : outcome;
          }
        case 'set-process-network-limit':
          if (!validPid(action.pid)) return { ok: false, reason: 'network policy requires a valid process id' };
          {
            const result = await applyWindowsTrafficShape(action, { commandRunner, approved: context.approved === true, dryRun: false });
            return { ok: result.state === 'applied', ...result };
          }
        case 'set-fps-policy':
          if (!fpsController || typeof fpsController.apply !== 'function') return { ok: false, reason: 'FPS controller backend is unavailable' };
          {
            const result = await fpsController.apply(action, context);
            return { ok: result?.ok === true, ...result };
          }
        case 'set-gpu-policy':
          if (!validGpuPowerLimit(action.limitWatts)) return { ok: false, reason: 'GPU power limit requires a bounded watt value' };
          return resultFromCommand(await commandRunner.run('nvidia-smi.exe', ['--power-limit', String(action.limitWatts)]), 'set-gpu-policy');
        case 'clear-cache': {
          const preview = await cacheCleaner.preview({ target: action.value, platform: 'win32' });
          return cacheCleaner.clean(preview, { approved: context.approved === true, dryRun: false });
        }
        case 'stop-approved-process':
          if (!validPid(pid) || context.allowProcessStop !== true || !approvedPid(context, pid)) {
            return { ok: false, reason: 'process stop requires an approved background process id' };
          }
          return resultFromCommand(await commandRunner.run('taskkill.exe', ['/PID', String(pid), '/T']), 'stop-approved-process');
        case 'set-process-io-priority':
        case 'set-memory-policy':
          return { ok: false, reason: `${action.type} is not supported by the Windows adapter` };
        default:
          return { ok: false, reason: 'unsupported native action' };
      }
    }
  };
}
