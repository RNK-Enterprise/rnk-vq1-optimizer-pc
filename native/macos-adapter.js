/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * macOS native adapter. Commands are fixed here and require local approval.
 * Unsupported controls remain explicit rather than being emulated.
 */

import { collectSystemFacts } from './system-facts.js';

const NICE_VALUES = Object.freeze({ low: '10', normal: '0', high: '-5' });

function resultFromCommand(result, operation) { return result?.code === 0 ? { ok: true, operation } : { ok: false, operation, reason: result?.stderr || `${operation} failed` }; }
function validPid(pid) { return Number.isInteger(pid) && pid > 0; }
function approvedPid(context, pid) { const list = context?.approvedBackgroundPids; return Array.isArray(list) ? list.includes(pid) : list instanceof Set ? list.has(pid) : false; }

export function createMacosAdapter({ commandRunner, cacheCleaner } = {}) {
  if (!commandRunner || typeof commandRunner.run !== 'function') throw new TypeError('macOS adapter requires a command runner');
  if (!cacheCleaner || typeof cacheCleaner.preview !== 'function' || typeof cacheCleaner.clean !== 'function') throw new TypeError('macOS adapter requires a cache cleaner');
  return {
    platform: 'darwin',
    requiresAdmin(action) { return (action.type === 'set-process-priority' && action.value === 'high') || action.type === 'stop-approved-process'; },
    collectFacts() { return collectSystemFacts({ platform: 'darwin', commandRunner }); },
    async applyAction(action, context = {}) {
      const pid = context.targetPid;
      switch (action.type) {
        case 'set-process-priority':
          if (!validPid(pid)) return { ok: false, reason: 'target process id is unavailable' };
          return resultFromCommand(await commandRunner.run('renice', ['-n', NICE_VALUES[action.value], '-p', String(pid)]), 'set-process-priority');
        case 'set-process-io-priority':
          if (!validPid(pid)) return { ok: false, reason: 'target process id is unavailable' };
          return resultFromCommand(await commandRunner.run('taskpolicy', [action.value === 'low' ? '-b' : '-B', '-p', String(pid)]), 'set-process-io-priority');
        case 'clear-cache': {
          const preview = await cacheCleaner.preview({ target: action.value, platform: 'darwin' });
          return cacheCleaner.clean(preview, { approved: context.approved === true, dryRun: false });
        }
        case 'stop-approved-process':
          if (!validPid(pid) || context.allowProcessStop !== true || !approvedPid(context, pid)) return { ok: false, reason: 'process stop requires an approved background process id' };
          return resultFromCommand(await commandRunner.run('kill', ['-TERM', String(pid)]), 'stop-approved-process');
        case 'set-process-affinity':
        case 'set-process-resource-limit':
        case 'set-gpu-policy':
        case 'set-memory-policy':
        case 'set-power-profile':
          return { ok: false, reason: `${action.type} is not supported by the macOS adapter` };
        default:
          return { ok: false, reason: 'unsupported native action' };
      }
    }
  };
}
