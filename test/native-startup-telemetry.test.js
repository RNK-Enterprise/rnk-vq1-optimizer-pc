/**
 * Native startup telemetry tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import path from 'path';
import {
  collectStartupTelemetry,
  parseStartupTelemetry,
  STARTUP_TELEMETRY_VERSION
} from '../native/startup-telemetry.js';

function runner(result) { return { run: jest.fn(async () => result) }; }

function entry(name, kind = 'file') {
  return {
    name,
    isSymbolicLink: () => kind === 'link',
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file'
  };
}

describe('startup parser', () => {
  test('normalizes Windows JSON and bounded text records', () => {
    const windows = parseStartupTelemetry(JSON.stringify([
      { Name: 'Updater', Command: 'up.exe', Location: 'HKCU', User: 'odinn' },
      { Name: '', Command: '', Location: '' }
    ]), { platform: 'win32' });
    expect(windows).toMatchObject({ version: STARTUP_TELEMETRY_VERSION, available: true, source: 'Win32_StartupCommand' });
    expect(windows.entries[0]).toMatchObject({ name: 'Updater', command: 'up.exe', location: 'HKCU', user: 'odinn', authority: 'review-only' });
    expect(windows.entries[1]).toMatchObject({ name: 'unnamed-startup', location: 'unknown' });
    expect(parseStartupTelemetry(JSON.stringify({ Name: 'One' }), { platform: 'win32' }).entries).toHaveLength(1);
    expect(parseStartupTelemetry('{bad}', { platform: 'win32' })).toMatchObject({ available: false, entries: [] });
    expect(parseStartupTelemetry(undefined, { platform: 'win32' })).toMatchObject({ available: false, entries: [] });
    const textFacts = parseStartupTelemetry('One\t/etc/startup\tstart\nTwo\tuser\t', { platform: 'linux' });
    expect(textFacts).toMatchObject({ available: true });
    expect(textFacts.entries[0]).toMatchObject({ name: 'One', location: '/etc/startup', command: 'start' });
    expect(parseStartupTelemetry()).toMatchObject({ available: false, entries: [] });
  });
});

describe('startup collectors', () => {
  test('reads fixed Linux and macOS startup roots', async () => {
    const roots = {
      '/home/test/.config/autostart': [entry('one.desktop'), entry('link.desktop', 'link'), entry('folder.desktop', 'directory'), entry('ignore.txt'), { name: 'unknown.desktop' }],
      '/etc/xdg/autostart': [entry('two.desktop')],
      '/home/test/Library/LaunchAgents': [entry('agent.plist')],
      '/Library/LaunchAgents': [entry('daemon.plist')],
      '/Library/LaunchDaemons': []
    };
    const fsImpl = { readdir: jest.fn(async (root) => roots[root] || []) };
    const linux = await collectStartupTelemetry({ platform: 'linux', env: { HOME: '/home/test' }, fsImpl, pathImpl: path.posix });
    expect(linux).toMatchObject({ version: 1, platform: 'linux', available: true, source: 'fixed-startup-roots', unreadableRoots: 0 });
    expect(linux.entries.map((item) => item.name)).toEqual(['one', 'two']);
    const mac = await collectStartupTelemetry({ platform: 'darwin', env: { HOME: '/home/test' }, fsImpl, pathImpl: path.posix });
    expect(mac).toMatchObject({ platform: 'darwin', available: true });
    expect(mac.entries.map((item) => item.name)).toEqual(['agent', 'daemon']);
    expect(await collectStartupTelemetry({ platform: 'linux', env: {}, fsImpl: { readdir: async () => [] } })).toMatchObject({ available: false });
    expect(await collectStartupTelemetry({ platform: 'darwin', env: {}, fsImpl: { readdir: async () => [] } })).toMatchObject({ available: false });
  });

  test('reports unreadable roots and bounded inventory', async () => {
    const fsImpl = { readdir: jest.fn(async (root) => { if (root === '/etc/xdg/autostart') throw new Error('denied'); return [entry('one.desktop')]; }) };
    await expect(collectStartupTelemetry({ platform: 'linux', env: { HOME: '/home/test' }, fsImpl, pathImpl: path.posix })).resolves.toMatchObject({ available: true, unreadableRoots: 1 });
    const many = Array.from({ length: 130 }, (_, index) => entry(`${index}.desktop`));
    await expect(collectStartupTelemetry({ platform: 'linux', env: { HOME: '/home/test' }, fsImpl: { readdir: async () => many }, pathImpl: path.posix })).resolves.toMatchObject({ available: true, entries: expect.any(Array) });
  });

  test('uses fixed Windows command and fails closed', async () => {
    const win = runner({ code: 0, stdout: JSON.stringify({ Name: 'Updater', Command: 'up.exe' }) });
    await expect(collectStartupTelemetry({ platform: 'win32', commandRunner: win })).resolves.toMatchObject({ platform: 'win32', available: true });
    expect(win.run.mock.calls[0][0]).toBe('powershell.exe');
    await expect(collectStartupTelemetry({ platform: 'win32', commandRunner: runner({ code: 1, stderr: 'denied' }) })).resolves.toMatchObject({ source: 'denied' });
    await expect(collectStartupTelemetry({ platform: 'win32', commandRunner: runner({ code: 1 }) })).resolves.toMatchObject({ source: 'startup command failed' });
    await expect(collectStartupTelemetry({ platform: 'win32', commandRunner: { run: jest.fn().mockRejectedValue(new Error('missing')) } })).resolves.toMatchObject({ source: 'missing' });
    await expect(collectStartupTelemetry({ platform: 'win32' })).resolves.toMatchObject({ source: 'command runner unavailable' });
    await expect(collectStartupTelemetry({ platform: 'freebsd', commandRunner: win })).resolves.toMatchObject({ source: 'platform unsupported' });
    await expect(collectStartupTelemetry()).resolves.toHaveProperty('version', STARTUP_TELEMETRY_VERSION);
  });
});
