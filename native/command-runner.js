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
 * Commands are selected by platform adapters from fixed allow-lists. This
 * runner never invokes a shell and never accepts a command string from a gateway.
 */

import { spawn } from 'child_process';

const SENSITIVE_ENV_KEY = /(TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|AUTHORIZATION)/i;

export function scrubChildEnvironment(env = process.env) {
  if (!env || typeof env !== 'object') return {};
  return Object.fromEntries(Object.entries(env).filter(([key]) => !SENSITIVE_ENV_KEY.test(key)));
}

export function createCommandRunner({
  spawnFile = spawn,
  env = process.env,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  const childEnv = scrubChildEnvironment(env);
  return {
    run(file, args = [], { timeoutMs = 5000, maxOutputBytes = 32768 } = {}) {
      if (typeof file !== 'string' || file.length === 0 || !Array.isArray(args)) {
        return Promise.reject(new TypeError('Command runner requires a file and argument array'));
      }
      return new Promise((resolve, reject) => {
        let child;
        try {
          child = spawnFile(file, args.map(String), {
            shell: false,
            windowsHide: true,
            env: childEnv
          });
        } catch (error) {
          reject(error);
          return;
        }

        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeoutImpl(() => {
          if (settled) return;
          settled = true;
          child.kill?.('SIGTERM');
          reject(new Error(`Command timed out: ${file}`));
        }, timeoutMs);

        const append = (target, chunk) => {
          const next = target + chunk.toString();
          return next.length > maxOutputBytes ? next.slice(0, maxOutputBytes) : next;
        };
        child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
        child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
        child.once('error', (error) => {
          if (settled) return;
          settled = true;
          clearTimeoutImpl(timer);
          reject(error);
        });
        child.once('close', (code, signal) => {
          if (settled) return;
          settled = true;
          clearTimeoutImpl(timer);
          resolve({ code, signal, stdout, stderr });
        });
      });
    }
  };
}
