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
 * Linux native adapter. Commands are fixed here and never supplied by VQ.
 */

import fs from 'fs/promises';
import path from 'path';
import { collectSystemFacts } from './system-facts.js';
import os from 'os';
import { MAX_RESOURCE_MEMORY_BYTES, MIN_RESOURCE_MEMORY_BYTES } from './protocol.js';

const POWER_PROFILES = Object.freeze({ balanced: 'balanced', performance: 'performance', battery: 'power-saver' });
const NICE_VALUES = Object.freeze({ low: '10', normal: '0', high: '-5' });
const IONICE_VALUES = Object.freeze({ low: '7', normal: '4', high: '0' });

function affinityMask(value, cpuCount) {
  if (!['balanced', 'performance'].includes(value)) return null;
  const count = Number.isInteger(cpuCount) && cpuCount > 0 ? Math.min(cpuCount, 63) : Math.min(os.cpus().length, 63);
  let mask = 0n;
  for (let index = 0; index < count; index += 1) {
    if (value === 'performance' || index % 2 === 0) mask |= 1n << BigInt(index);
  }
  return `0x${mask.toString(16)}`;
}

function resultFromCommand(result, operation) {
  if (result?.code === 0) return { ok: true, operation };
  return { ok: false, operation, reason: result?.stderr || `${operation} failed` };
}

function validPid(pid) {
  return Number.isInteger(pid) && pid > 0;
}

function validResourceLimit(action) {
  return action && ['cpu-percent', 'memory-bytes'].includes(action.value)
    && Number.isInteger(action.limit) && action.limit > 0
    && (action.value !== 'cpu-percent' || action.limit <= 100)
    && (action.value !== 'memory-bytes' || (action.limit >= MIN_RESOURCE_MEMORY_BYTES && action.limit <= MAX_RESOURCE_MEMORY_BYTES));
}

function approvedPid(context, pid) {
  const list = context?.approvedBackgroundPids;
  return Array.isArray(list) ? list.includes(pid) : list instanceof Set ? list.has(pid) : false;
}

function cgroupName(root, pid) { return path.join(root, `rnk-optimizer-${pid}`); }

async function applyCpuCgroupLimit(pid, limit, { fsImpl, cgroupRoot }) {
  try {
    const controllers = String(await fsImpl.readFile(path.join(cgroupRoot, 'cgroup.controllers'))).split(/\s+/).filter(Boolean);
    if (!controllers.includes('cpu')) return { ok: false, reason: 'Linux cgroup CPU controller is unavailable' };
    const group = cgroupName(cgroupRoot, pid);
    await fsImpl.mkdir(group, { recursive: true });
    const period = 100000;
    const quota = Math.max(1000, Math.floor(period * limit / 100));
    await fsImpl.writeFile(path.join(group, 'cpu.max'), `${quota} ${period}`);
    await fsImpl.writeFile(path.join(group, 'cgroup.procs'), String(pid));
    return { ok: true, operation: 'set-process-resource-limit', mechanism: 'cgroup-v2', group, quota, period };
  } catch (error) {
    return { ok: false, reason: error?.message || 'Linux cgroup CPU limit failed' };
  }
}

export function createLinuxAdapter({ commandRunner, cacheCleaner, cpuCount = os.cpus().length, fsImpl = fs, cgroupRoot = '/sys/fs/cgroup' } = {}) {
  if (!commandRunner || typeof commandRunner.run !== 'function') throw new TypeError('Linux adapter requires a command runner');
  if (!cacheCleaner || typeof cacheCleaner.preview !== 'function' || typeof cacheCleaner.clean !== 'function') {
    throw new TypeError('Linux adapter requires a cache cleaner');
  }

  return {
    platform: 'linux',

    requiresAdmin(action) {
      return action.type === 'set-power-profile'
        || action.type === 'stop-approved-process'
        || action.type === 'set-process-affinity'
        || (action.type === 'set-process-resource-limit' && action.value === 'memory-bytes')
        || (action.type === 'set-process-resource-limit' && action.value === 'cpu-percent')
        || (action.type === 'set-process-priority' && action.value === 'high')
        || (action.type === 'set-process-io-priority' && action.value === 'high');
    },

    collectFacts() {
      return collectSystemFacts({ platform: 'linux', commandRunner });
    },

    async applyAction(action, context = {}) {
      const pid = context.targetPid;
      switch (action.type) {
        case 'set-power-profile':
          return resultFromCommand(await commandRunner.run('powerprofilesctl', ['set', POWER_PROFILES[action.value]]), 'set-power-profile');
        case 'set-process-priority':
          if (!validPid(pid)) return { ok: false, reason: 'target process id is unavailable' };
          return resultFromCommand(await commandRunner.run('renice', ['-n', NICE_VALUES[action.value], '-p', String(pid)]), 'set-process-priority');
        case 'set-process-io-priority':
          if (!validPid(pid)) return { ok: false, reason: 'target process id is unavailable' };
          return resultFromCommand(await commandRunner.run('ionice', ['-c', '2', '-n', IONICE_VALUES[action.value], '-p', String(pid)]), 'set-process-io-priority');
        case 'set-process-affinity': {
          if (!validPid(pid)) return { ok: false, reason: 'target process id is unavailable' };
          const mask = affinityMask(action.value, cpuCount);
          if (!mask) return { ok: false, reason: 'unsupported process affinity value' };
          return resultFromCommand(await commandRunner.run('taskset', ['-p', mask, String(pid)]), 'set-process-affinity');
        }
        case 'set-process-resource-limit':
          if (!validPid(pid)) return { ok: false, reason: 'target process id is unavailable' };
          if (!validResourceLimit(action)) return { ok: false, reason: 'resource limit value is invalid' };
          if (action.value === 'cpu-percent') return applyCpuCgroupLimit(pid, action.limit, { fsImpl, cgroupRoot });
          return resultFromCommand(await commandRunner.run('prlimit', ['--pid', String(pid), `--as=${action.limit}:${action.limit}`]), 'set-process-resource-limit');
        case 'clear-cache': {
          const preview = await cacheCleaner.preview({ target: action.value, platform: 'linux' });
          return cacheCleaner.clean(preview, { approved: context.approved === true, dryRun: false });
        }
        case 'stop-approved-process':
          if (!validPid(pid) || context.allowProcessStop !== true || !approvedPid(context, pid)) {
            return { ok: false, reason: 'process stop requires an approved background process id' };
          }
          return resultFromCommand(await commandRunner.run('kill', ['-TERM', String(pid)]), 'stop-approved-process');
        case 'set-gpu-policy':
        case 'set-memory-policy':
          return { ok: false, reason: `${action.type} is not supported by the Linux adapter` };
        default:
          return { ok: false, reason: 'unsupported native action' };
      }
    }
  };
}
