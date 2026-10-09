/**
 * FPS adapter boundary tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { createLinuxAdapter } from '../native/linux-adapter.js';
import { createMacosAdapter } from '../native/macos-adapter.js';
import { createWindowsAdapter } from '../native/windows-adapter.js';

const action = { type: 'set-fps-policy', key: 'fps.policy', value: 'cap', limit: 60 };
function runner() { return { run: jest.fn(async () => ({ code: 0 })) }; }
function cleaner() { return { preview: jest.fn(async () => ({})), clean: jest.fn(async () => ({ ok: true })) }; }

describe('FPS adapter boundaries', () => {
  test('Windows and Linux delegate only to injected controller backends', async () => {
    const windowsRunner = runner();
    const windows = createWindowsAdapter({ commandRunner: windowsRunner, cacheCleaner: cleaner() });
    expect(windows.requiresAdmin(action)).toBe(true);
    await expect(windows.applyAction(action)).resolves.toMatchObject({ ok: false, reason: 'FPS controller backend is unavailable' });
    const windowsWithController = createWindowsAdapter({ commandRunner: windowsRunner, cacheCleaner: cleaner(), fpsController: { apply: jest.fn(async () => ({ ok: true, backend: 'rtss' })) } });
    await expect(windowsWithController.applyAction(action)).resolves.toMatchObject({ ok: true, backend: 'rtss' });
    const linuxRunner = runner();
    const linux = createLinuxAdapter({ commandRunner: linuxRunner, cacheCleaner: cleaner(), fpsController: { apply: jest.fn(async () => ({ ok: true, backend: 'gamescope' })) } });
    expect(linux.requiresAdmin(action)).toBe(true);
    await expect(linux.applyAction(action)).resolves.toMatchObject({ ok: true, backend: 'gamescope' });
    const linuxWithoutController = createLinuxAdapter({ commandRunner: runner(), cacheCleaner: cleaner() });
    await expect(linuxWithoutController.applyAction(action)).resolves.toMatchObject({ ok: false, reason: 'FPS controller backend is unavailable' });
  });

  test('macOS refuses a portable FPS hard cap', async () => {
    const mac = createMacosAdapter({ commandRunner: runner(), cacheCleaner: cleaner() });
    await expect(mac.applyAction(action)).resolves.toMatchObject({ ok: false, reason: 'set-fps-policy is not supported by the macOS adapter' });
  });
});
