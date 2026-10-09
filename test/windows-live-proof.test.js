/**
 * Read-only Windows host proof probes.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { createCommandRunner } from '../native/command-runner.js';
import { createPlatformAdapter } from '../native/platform.js';
import { collectVolumeStorage } from '../native/volume-storage.js';

describe('WINDOWS_LIVE_PROOF', () => {
  test('collects read-only Windows facts on a Windows runner', async () => {
    if (process.platform !== 'win32') return;
    const adapter = createPlatformAdapter({ platform: 'win32', commandRunner: createCommandRunner() });
    await expect(adapter.collectFacts()).resolves.toEqual(expect.objectContaining({ platform: 'win32' }));
  });

  test('collects read-only mounted-volume identity on a Windows runner', async () => {
    if (process.platform !== 'win32') return;
    await expect(collectVolumeStorage({ platform: 'win32', commandRunner: createCommandRunner() })).resolves.toEqual(expect.objectContaining({ platform: 'win32' }));
  });
});
