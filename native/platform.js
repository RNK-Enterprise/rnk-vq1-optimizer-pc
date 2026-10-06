/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 RNK Enterprise
 * Contributor: RNK Enterprise
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
 * Native platform selection. Unsupported operating systems remain observable
 * but cannot execute an action.
 */

import { createCommandRunner } from './command-runner.js';
import { createCacheCleaner } from './cache-cleaner.js';
import { createLinuxAdapter } from './linux-adapter.js';
import { createWindowsAdapter } from './windows-adapter.js';
import { collectBaseFacts } from './system-facts.js';

function createUnsupportedAdapter(platform) {
  return {
    platform,
    collectFacts: () => collectBaseFacts({ platform }),
    applyAction: async () => ({ ok: false, reason: `unsupported platform: ${platform}` })
  };
}

export function createPlatformAdapter({ platform = process.platform, commandRunner, cacheCleaner } = {}) {
  const runner = commandRunner || createCommandRunner();
  const cleaner = cacheCleaner || createCacheCleaner();
  if (platform === 'win32') return createWindowsAdapter({ commandRunner: runner, cacheCleaner: cleaner });
  if (platform === 'linux') return createLinuxAdapter({ commandRunner: runner, cacheCleaner: cleaner });
  return createUnsupportedAdapter(platform);
}
