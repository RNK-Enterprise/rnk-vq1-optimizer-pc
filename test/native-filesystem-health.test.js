/**
 * Native filesystem health tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import path from 'path';
import { buildFilesystemHealthPlan, collectFilesystemHealth, FILESYSTEM_HEALTH_VERSION, parseDarwinFilesystemHealth, parseLinuxFilesystemHealth, parseWindowsFilesystemHealth } from '../native/filesystem-health.js';

describe('native filesystem health', () => {
  test('builds fixed read-only plans and parses platform evidence', () => {
    expect(buildFilesystemHealthPlan()).toMatchObject({ version: FILESYSTEM_HEALTH_VERSION, state: 'refused' });
    expect(buildFilesystemHealthPlan('https://example.com')).toMatchObject({ state: 'refused' });
    expect(buildFilesystemHealthPlan('/tmp/../etc', { platform: 'linux' })).toMatchObject({ state: 'refused' });
    expect(buildFilesystemHealthPlan('C:\\', { platform: 'win32', pathImpl: path.win32 })).toMatchObject({ state: 'plan-ready', command: { file: 'powershell.exe' } });
    expect(buildFilesystemHealthPlan('C:\\folder', { platform: 'win32' })).toMatchObject({ state: 'refused', reason: 'Windows filesystem health requires a drive root' });
    expect(buildFilesystemHealthPlan('/mnt/data', { platform: 'linux' })).toMatchObject({ state: 'plan-ready', command: { file: 'findmnt' } });
    expect(buildFilesystemHealthPlan('/Volumes/data', { platform: 'darwin' })).toMatchObject({ state: 'plan-ready', command: { file: 'diskutil' } });
    expect(buildFilesystemHealthPlan('/data', { platform: 'freebsd' })).toMatchObject({ state: 'unsupported-platform' });
    expect(parseWindowsFilesystemHealth(JSON.stringify({ DriveLetter: 'C', FileSystem: 'NTFS', HealthStatus: 'Healthy', Size: '100', SizeRemaining: 40 }), { root: 'C:\\' })).toMatchObject({ available: true, filesystem: 'NTFS', health: 'healthy', totalBytes: 100, freeBytes: 40 });
    expect(parseWindowsFilesystemHealth(JSON.stringify([{ FileSystem: 'exFAT', HealthStatus: 'Warning' }]))).toMatchObject({ available: true, health: 'warning' });
    expect(parseWindowsFilesystemHealth(JSON.stringify({}))).toMatchObject({ available: true, filesystem: null, health: 'unknown' });
    expect(parseLinuxFilesystemHealth(JSON.stringify({ filesystems: [{ target: '/', source: '/dev/sda1', fstype: 'ext4', options: 'rw' }] }), { root: '/' })).toMatchObject({ available: true, filesystem: 'ext4', device: '/dev/sda1', mountpoint: '/' });
    expect(parseDarwinFilesystemHealth('Device Identifier: disk1s1\nFile System Personality: APFS\nMounted: Yes', { root: '/Volumes/data' })).toMatchObject({ available: true, filesystem: 'APFS', health: 'mounted', device: 'disk1s1' });
    expect(parseDarwinFilesystemHealth('Device Identifier: disk2\nType (Bundle): HFS\nMounted: No')).toMatchObject({ available: true, filesystem: 'HFS', health: 'unknown', device: 'disk2' });
  });

  test('fails closed on malformed and empty checker output', () => {
    expect(parseWindowsFilesystemHealth('{bad}')).toMatchObject({ available: false, reason: 'filesystem checker returned invalid JSON' });
    expect(parseWindowsFilesystemHealth('null')).toMatchObject({ available: false, reason: 'filesystem checker returned an invalid record' });
    expect(parseLinuxFilesystemHealth('{bad}')).toMatchObject({ available: false, reason: 'findmnt returned invalid JSON' });
    expect(parseLinuxFilesystemHealth('{}')).toMatchObject({ available: false, reason: 'findmnt returned no filesystem record' });
    expect(parseWindowsFilesystemHealth()).toMatchObject({ available: false, reason: 'filesystem checker returned invalid JSON' });
    expect(parseLinuxFilesystemHealth()).toMatchObject({ available: false, reason: 'findmnt returned invalid JSON' });
    expect(parseDarwinFilesystemHealth('')).toMatchObject({ available: false });
  });

  test('collects fixed commands and preserves unavailable states', async () => {
    const runner = { run: jest.fn(async () => ({ code: 0, stdout: JSON.stringify({ filesystems: [{ target: '/', source: '/dev/sda1', fstype: 'ext4' }] }) })) };
    await expect(collectFilesystemHealth('/')).resolves.toMatchObject({ available: false, reason: 'command runner unavailable' });
    await expect(collectFilesystemHealth('/', { platform: 'linux', commandRunner: runner })).resolves.toMatchObject({ available: true, source: 'findmnt' });
    expect(runner.run).toHaveBeenCalledWith('findmnt', expect.any(Array), expect.any(Object));
    await expect(collectFilesystemHealth('/', { platform: 'linux' })).resolves.toMatchObject({ available: false, reason: 'command runner unavailable' });
    await expect(collectFilesystemHealth('/data', { platform: 'freebsd', commandRunner: runner })).resolves.toMatchObject({ available: false, reason: 'filesystem health checker is unavailable' });
    await expect(collectFilesystemHealth('/', { platform: 'linux', commandRunner: { run: jest.fn(async () => ({ code: 1, stderr: 'denied' })) } })).resolves.toMatchObject({ available: false, reason: 'denied' });
    await expect(collectFilesystemHealth('/', { platform: 'linux', commandRunner: { run: jest.fn(async () => ({ code: 1 })) } })).resolves.toMatchObject({ available: false, reason: 'filesystem checker failed' });
    await expect(collectFilesystemHealth('/', { platform: 'linux', commandRunner: { run: jest.fn(async () => ({ code: 0, stdout: '{bad}' })) } })).resolves.toMatchObject({ available: false, reason: 'findmnt returned invalid JSON' });
    await expect(collectFilesystemHealth('/', { platform: 'linux', commandRunner: { run: jest.fn(async () => { throw new Error('missing'); }) } })).resolves.toMatchObject({ available: false, reason: 'missing' });
    await expect(collectFilesystemHealth('C:\\', { platform: 'win32', pathImpl: path.win32, commandRunner: { run: jest.fn(async () => ({ code: 0, stdout: JSON.stringify({ FileSystem: 'NTFS', HealthStatus: 'Healthy', Size: 100, SizeRemaining: 40 }) })) } })).resolves.toMatchObject({ available: true, filesystem: 'NTFS' });
    await expect(collectFilesystemHealth('/Volumes/data', { platform: 'darwin', commandRunner: { run: jest.fn(async () => ({ code: 0, stdout: 'Device Identifier: disk1\nFile System Personality: APFS\nMounted: Yes' })) } })).resolves.toMatchObject({ available: true, filesystem: 'APFS' });
  });
});
