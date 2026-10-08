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

const POWER_GUIDS = Object.freeze({
  balanced: '381b4222-f694-41f0-9685-ff5bb260df2e',
  performance: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  battery: 'a1841308-3541-4fab-bc81-f71556f20b4a'
});

const PRIORITY_CLASSES = Object.freeze({ low: 'BelowNormal', normal: 'Normal', high: 'AboveNormal' });

function resultFromCommand(result, operation) {
  if (result?.code === 0) return { ok: true, operation };
  return { ok: false, operation, reason: result?.stderr || `${operation} failed` };
}

function validPid(pid) {
  return Number.isInteger(pid) && pid > 0 && pid <= 2147483647;
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
      return action.type === 'stop-approved-process' || action.type === 'set-process-affinity';
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
