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

import { collectSystemFacts } from './system-facts.js';

const POWER_PROFILES = Object.freeze({ balanced: 'balanced', performance: 'performance', battery: 'power-saver' });
const NICE_VALUES = Object.freeze({ low: '10', normal: '0', high: '-5' });
const IONICE_VALUES = Object.freeze({ low: '7', normal: '4', high: '0' });

function resultFromCommand(result, operation) {
  if (result?.code === 0) return { ok: true, operation };
  return { ok: false, operation, reason: result?.stderr || `${operation} failed` };
}

function validPid(pid) {
  return Number.isInteger(pid) && pid > 0;
}

function approvedPid(context, pid) {
  const list = context?.approvedBackgroundPids;
  return Array.isArray(list) ? list.includes(pid) : list instanceof Set ? list.has(pid) : false;
}

export function createLinuxAdapter({ commandRunner, cacheCleaner } = {}) {
  if (!commandRunner || typeof commandRunner.run !== 'function') throw new TypeError('Linux adapter requires a command runner');
  if (!cacheCleaner || typeof cacheCleaner.preview !== 'function' || typeof cacheCleaner.clean !== 'function') {
    throw new TypeError('Linux adapter requires a cache cleaner');
  }

  return {
    platform: 'linux',

    requiresAdmin(action) {
      return action.type === 'set-power-profile'
        || action.type === 'stop-approved-process'
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
        case 'clear-cache': {
          const preview = await cacheCleaner.preview({ target: action.value, platform: 'linux' });
          return cacheCleaner.clean(preview, { approved: context.approved === true, dryRun: false });
        }
        case 'stop-approved-process':
          if (!validPid(pid) || context.allowProcessStop !== true || !approvedPid(context, pid)) {
            return { ok: false, reason: 'process stop requires an approved background process id' };
          }
          return resultFromCommand(await commandRunner.run('kill', ['-TERM', String(pid)]), 'stop-approved-process');
        case 'set-process-affinity':
        case 'set-gpu-policy':
        case 'set-memory-policy':
          return { ok: false, reason: `${action.type} is not supported by the Linux adapter` };
        default:
          return { ok: false, reason: 'unsupported native action' };
      }
    }
  };
}
