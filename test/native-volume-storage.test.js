/**
 * Native mounted-volume storage tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { collectVolumeStorage, parseDarwinVolumeStorage, parseLinuxVolumeStorage, parseWindowsVolumeStorage, VOLUME_STORAGE_VERSION } from '../native/volume-storage.js';

describe('native volume storage', () => {
  test('parses bounded Windows volume facts', () => {
    const parsed = parseWindowsVolumeStorage(JSON.stringify([
      { DriveLetter: 'c', FileSystem: 'NTFS', HealthStatus: 'Healthy', Size: '100', SizeRemaining: '40', IsReadOnly: true, DriveType: 'Fixed' },
      { DriveLetter: 'E:', Size: 200, SizeRemaining: null },
      { DriveLetter: null, Size: 300 }
    ]));
    expect(parsed).toMatchObject({ version: VOLUME_STORAGE_VERSION, platform: 'win32', available: true, source: 'Get-Volume' });
    expect(parsed.volumes).toMatchObject([
      { mount: 'C:', device: 'C:', filesystem: 'NTFS', health: 'healthy', totalBytes: 100, freeBytes: 40, usedBytes: 60, usedPercent: 60, readOnly: true, type: 'Fixed' },
      { mount: 'E:', totalBytes: 200, freeBytes: null, usedBytes: null, usedPercent: null, readOnly: false }
    ]);
    expect(parseWindowsVolumeStorage(JSON.stringify({ DriveLetter: 'D', Size: 50, SizeRemaining: 20 })).volumes).toHaveLength(1);
    expect(parseWindowsVolumeStorage('{bad}')).toMatchObject({ available: false, reason: 'invalid JSON' });
    expect(parseWindowsVolumeStorage()).toMatchObject({ available: false, reason: 'invalid JSON' });
    expect(parseWindowsVolumeStorage('null')).toMatchObject({ available: false, volumes: [] });
    expect(parseWindowsVolumeStorage(JSON.stringify({ DriveLetter: 'D' }))).toMatchObject({ available: false, volumes: [] });
  });

  test('parses Linux and macOS mounted-volume facts and rejects malformed rows', () => {
    expect(parseLinuxVolumeStorage('Filesystem 1B-blocks Avail Mounted on\n/dev/sda1 1000 400 /\nshort\n/dev/bad nope 1 /bad')).toMatchObject({
      platform: 'linux', available: true, volumes: [{ device: '/dev/sda1', mount: '/', totalBytes: 1000, freeBytes: 400, usedBytes: 600, usedPercent: 60 }]
    });
    expect(parseDarwinVolumeStorage('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk1s1 1000 400 600 40% /Volumes/Data')).toMatchObject({
      platform: 'darwin', available: true, volumes: [{ device: '/dev/disk1s1', mount: '/Volumes/Data', totalBytes: 1024000, freeBytes: 614400, usedBytes: 409600 }]
    });
    expect(parseLinuxVolumeStorage('')).toMatchObject({ available: false, volumes: [] });
    expect(parseDarwinVolumeStorage('Filesystem\nshort')).toMatchObject({ available: false, volumes: [] });
  });

  test('collects through fixed platform commands and fails closed', async () => {
    const windows = { run: jest.fn(async () => ({ code: 0, stdout: JSON.stringify({ DriveLetter: 'C', Size: 100, SizeRemaining: 50 }) })) };
    await expect(collectVolumeStorage({ platform: 'win32', commandRunner: windows })).resolves.toMatchObject({ available: true, commandAvailable: true, volumes: [{ mount: 'C:' }] });
    expect(windows.run).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-Command', expect.stringContaining('Get-Volume')]), expect.any(Object));
    const linux = { run: jest.fn(async () => ({ code: 0, stdout: 'Filesystem 1B-blocks Avail Mounted on\n/dev/sda 100 50 /' })) };
    await expect(collectVolumeStorage({ platform: 'linux', commandRunner: linux })).resolves.toMatchObject({ available: true, volumes: [{ mount: '/' }] });
    expect(linux.run).toHaveBeenCalledWith('df', ['-B1', '--output=source,size,avail,target'], expect.any(Object));
    const darwin = { run: jest.fn(async () => ({ code: 0, stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk0 100 20 80 20% /' })) };
    await expect(collectVolumeStorage({ platform: 'darwin', commandRunner: darwin })).resolves.toMatchObject({ available: true, volumes: [{ mount: '/', freeBytes: 81920 }] });
    await expect(collectVolumeStorage({ platform: 'freebsd', commandRunner: linux })).resolves.toMatchObject({ available: false, reason: 'platform unsupported' });
    await expect(collectVolumeStorage({ platform: 'linux' })).resolves.toMatchObject({ available: false, reason: 'command runner unavailable' });
    await expect(collectVolumeStorage()).resolves.toMatchObject({ available: false, reason: 'command runner unavailable' });
    await expect(collectVolumeStorage({ platform: 'linux', commandRunner: { run: jest.fn(async () => ({ code: 1, stderr: 'denied' })) } })).resolves.toMatchObject({ available: false, reason: 'denied' });
    await expect(collectVolumeStorage({ platform: 'linux', commandRunner: { run: jest.fn(async () => ({ code: 1 })) } })).resolves.toMatchObject({ available: false, reason: 'volume command failed' });
    await expect(collectVolumeStorage({ platform: 'linux', commandRunner: { run: jest.fn(async () => { throw new Error('missing'); }) } })).resolves.toMatchObject({ available: false, reason: 'missing' });
  });
});
