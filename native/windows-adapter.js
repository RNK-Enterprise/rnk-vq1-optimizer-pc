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
 * Windows native adapter. Only fixed, reviewable commands live here. VQ
 * payloads never select an executable, argument, path, or process id.
 */

import { collectSystemFacts } from './system-facts.js';
import { MAX_RESOURCE_MEMORY_BYTES, MIN_RESOURCE_MEMORY_BYTES } from './protocol.js';

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
  '[DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);',
  '[DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);',
  '[DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint length);',
  '[DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);',
  'public static int Apply(int pid, long memory, int cpu) {',
  'if (memory <= 0 && cpu <= 0) return 87;',
  'IntPtr job = CreateJobObject(IntPtr.Zero, null); if (job == IntPtr.Zero) return Marshal.GetLastWin32Error();',
  'IntPtr process = OpenProcess(0x0501, false, (uint)pid); if (process == IntPtr.Zero) { int e = Marshal.GetLastWin32Error(); CloseHandle(job); return e; }',
  'try {',
  'if (memory > 0) { var info = new Extended(); info.BasicInfo.Flags = 0x100; info.ProcessMemory = (UIntPtr)(ulong)memory; IntPtr ptr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Extended))); try { Marshal.StructureToPtr(info, ptr, false); if (!SetInformationJobObject(job, 9, ptr, (uint)Marshal.SizeOf(typeof(Extended)))) return Marshal.GetLastWin32Error(); } finally { Marshal.FreeHGlobal(ptr); } }',
  'if (cpu > 0) { var info = new CpuRate { Flags = 1, Rate = (uint)(cpu * 100) }; IntPtr ptr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(CpuRate))); try { Marshal.StructureToPtr(info, ptr, false); if (!SetInformationJobObject(job, 15, ptr, (uint)Marshal.SizeOf(typeof(CpuRate)))) return Marshal.GetLastWin32Error(); } finally { Marshal.FreeHGlobal(ptr); } }',
  'if (!AssignProcessToJobObject(job, process)) return Marshal.GetLastWin32Error(); return 0;',
  '} finally { CloseHandle(process); CloseHandle(job); }',
  '} }',
  '"@;',
  'Add-Type -TypeDefinition $source -ErrorAction Stop;',
  '$memory = 0; $cpu = 0;',
  'if ($args[2] -eq "memory-bytes") { $memory = [Int64]$args[1] } else { $cpu = [Int32]$args[1] }',
  '$result = [RnkResourceJob]::Apply([Int32]$args[0], $memory, $cpu); if ($result -ne 0) { exit $result }'
].join('\n');

function resultFromCommand(result, operation) {
  if (result?.code === 0) return { ok: true, operation };
  return { ok: false, operation, reason: result?.stderr || `${operation} failed` };
}

function validPid(pid) {
  return Number.isInteger(pid) && pid > 0 && pid <= 2147483647;
}

function validResourceLimit(action) {
  return action && ['cpu-percent', 'memory-bytes'].includes(action.value)
    && Number.isInteger(action.limit) && action.limit > 0
    && (action.value !== 'cpu-percent' || action.limit <= 100)
    && (action.value !== 'memory-bytes' || (action.limit >= MIN_RESOURCE_MEMORY_BYTES && action.limit <= MAX_RESOURCE_MEMORY_BYTES));
}

function approvedPid(context, pid) {
  const list = context?.approvedBackgroundPids;
  if (Array.isArray(list)) return list.includes(pid);
  if (list instanceof Set) return list.has(pid);
  return false;
}

export function createWindowsAdapter({ commandRunner, cacheCleaner } = {}) {
  if (!commandRunner || typeof commandRunner.run !== 'function') throw new TypeError('Windows adapter requires a command runner');
  if (!cacheCleaner || typeof cacheCleaner.preview !== 'function' || typeof cacheCleaner.clean !== 'function') {
    throw new TypeError('Windows adapter requires a cache cleaner');
  }

  return {
    platform: 'win32',

    requiresAdmin(action) {
      return action.type === 'stop-approved-process'
        || action.type === 'set-process-affinity'
        || action.type === 'set-process-resource-limit';
    },

    collectFacts() {
      return collectSystemFacts({ platform: 'win32', commandRunner });
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
          return resultFromCommand(await commandRunner.run('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
            RESOURCE_LIMIT_SCRIPT, '--', String(pid), String(action.limit), action.value
          ]), 'set-process-resource-limit');
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
        case 'set-gpu-policy':
        case 'set-memory-policy':
          return { ok: false, reason: `${action.type} is not supported by the Windows adapter` };
        default:
          return { ok: false, reason: 'unsupported native action' };
      }
    }
  };
}
