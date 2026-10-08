/**
 * Native drive health tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { collectDriveHealth, collectSmartHealth, DRIVE_HEALTH_VERSION, parseDarwinDriveHealth, parseLinuxDriveHealth, parseWindowsDriveHealth } from '../native/drive-health.js';

describe('native drive health', () => {
  test('parses Windows, Linux, and macOS drive inventory evidence', () => {
    const windows = parseWindowsDriveHealth(JSON.stringify([{ FriendlyName: 'Fast SSD', SerialNumber: 's1', MediaType: 'SSD', Size: '100', HealthStatus: 'Healthy' }, { FriendlyName: 'Archive HDD', MediaType: 0, Size: 200, HealthStatus: 'Warning', MountPoint: 'E:' }, { DeviceID: 'PhysicalDrive2', MediaType: 'HDD', HealthStatus: 'Failed' }]));
    expect(windows).toMatchObject({ version: DRIVE_HEALTH_VERSION, available: true, drives: [{ mediaType: 'ssd', health: 'healthy' }, { mediaType: 'unknown', health: 'degraded', mountpoints: ['E:'] }, { mediaType: 'hdd', health: 'failed' }] });
    const linux = parseLinuxDriveHealth(JSON.stringify({ blockdevices: [{ name: 'nvme0n1', type: 'disk', size: 1000, rota: false, model: 'NVMe', serial: 'n1', mountpoints: ['/'] }, { name: 'sda', type: 'disk', size: 2000, rota: true }, { name: 'sda1', type: 'part', size: 10, rota: true }] }));
    expect(linux.drives).toMatchObject([{ device: 'nvme0n1', mediaType: 'ssd', health: 'unknown', mountpoints: ['/'] }, { device: 'sda', mediaType: 'hdd' }]);
    const darwin = parseDarwinDriveHealth('/dev/disk0 (internal, physical):\n/dev/disk1 (external):');
    expect(darwin).toMatchObject({ available: true, drives: [{ device: '/dev/disk0', mediaType: 'hdd' }, { device: '/dev/disk1', mediaType: 'unknown' }] });
  });

  test('fails closed on malformed or empty inventory', () => {
    expect(parseWindowsDriveHealth('{bad}')).toMatchObject({ available: false, reason: 'invalid JSON' });
    expect(parseWindowsDriveHealth()).toMatchObject({ available: false, reason: 'invalid JSON' });
    expect(parseWindowsDriveHealth('null')).toMatchObject({ available: false, drives: [] });
    expect(parseLinuxDriveHealth(JSON.stringify({ blockdevices: [{ type: 'part' }] }))).toMatchObject({ available: false, drives: [] });
    expect(parseLinuxDriveHealth('{}')).toMatchObject({ available: false, drives: [] });
    expect(parseLinuxDriveHealth()).toMatchObject({ available: false, reason: 'invalid JSON' });
    expect(parseDarwinDriveHealth('')).toMatchObject({ available: false, drives: [] });
  });

  test('collects only through fixed platform commands and reports failures', async () => {
    const calls = [];
    const runner = { run: jest.fn(async (command, args) => { calls.push({ command, args }); return { code: 0, stdout: JSON.stringify({ blockdevices: [{ name: 'sda', type: 'disk', size: 10, rota: true }] }) }; }) };
    await expect(collectDriveHealth({ platform: 'linux', commandRunner: runner })).resolves.toMatchObject({ available: true, commandAvailable: true });
    expect(calls[0]).toMatchObject({ command: 'lsblk' });
    await expect(collectDriveHealth({ platform: 'freebsd', commandRunner: runner })).resolves.toMatchObject({ available: false, reason: 'platform unsupported' });
    await expect(collectDriveHealth({ platform: 'linux' })).resolves.toMatchObject({ available: false, reason: 'command runner unavailable' });
    await expect(collectDriveHealth()).resolves.toMatchObject({ available: false, reason: 'command runner unavailable' });
    const windowsRunner = { run: jest.fn(async () => ({ code: 0, stdout: JSON.stringify({ FriendlyName: 'SSD', MediaType: 'SSD', HealthStatus: 'Healthy' }) })) };
    await expect(collectDriveHealth({ platform: 'win32', commandRunner: windowsRunner })).resolves.toMatchObject({ available: true, drives: [{ mediaType: 'ssd' }] });
    const darwinRunner = { run: jest.fn(async () => ({ code: 0, stdout: '/dev/disk0 (internal, physical):' })) };
    await expect(collectDriveHealth({ platform: 'darwin', commandRunner: darwinRunner })).resolves.toMatchObject({ available: true, drives: [{ device: '/dev/disk0' }] });
    const failure = { run: jest.fn(async () => ({ code: 1, stderr: 'denied' })) };
    await expect(collectDriveHealth({ platform: 'linux', commandRunner: failure })).resolves.toMatchObject({ available: false, reason: 'denied' });
    const bareFailure = { run: jest.fn(async () => ({ code: 1 })) };
    await expect(collectDriveHealth({ platform: 'linux', commandRunner: bareFailure })).resolves.toMatchObject({ available: false, reason: 'drive inventory command failed' });
    const badJson = { run: jest.fn(async () => ({ code: 0, stdout: '{bad}' })) };
    await expect(collectDriveHealth({ platform: 'win32', commandRunner: badJson })).resolves.toMatchObject({ available: false, source: 'Get-PhysicalDisk' });
  });

  test('validates SMART device paths and reports pass/fail/tool errors', async () => {
    const runner = { run: jest.fn(async (_command, args) => ({ code: args[2] === '/dev/sdb' ? 0 : 2, stdout: args[2] === '/dev/sdb' ? 'SMART overall-health self-assessment test result: PASSED' : '', stderr: args[2] === '/dev/sdc' ? 'SMART overall-health self-assessment test result: FAILED' : '' })) };
    await expect(collectSmartHealth('../secret', { platform: 'linux', commandRunner: runner })).resolves.toMatchObject({ available: false, health: 'unknown' });
    await expect(collectSmartHealth('/dev/sdb', { platform: 'linux', commandRunner: runner })).resolves.toMatchObject({ available: true, health: 'healthy' });
    await expect(collectSmartHealth('/dev/sdc', { platform: 'linux', commandRunner: runner })).resolves.toMatchObject({ available: true, health: 'failed' });
    await expect(collectSmartHealth('\\\\.\\PhysicalDrive0', { platform: 'win32', commandRunner: runner })).resolves.toMatchObject({ available: false, health: 'unknown' });
    await expect(collectSmartHealth('/dev/sdf', { platform: 'linux', commandRunner: runner })).resolves.toMatchObject({ available: false, health: 'unknown' });
    const secondary = { run: jest.fn(async () => ({ code: 2, stdout: 'SMART Health Status: OK', stderr: '' })) };
    await expect(collectSmartHealth('/dev/sdg', { platform: 'linux', commandRunner: secondary })).resolves.toMatchObject({ available: true, health: 'healthy' });
    const noCode = { run: jest.fn(async () => ({ stdout: 'unrecognized device' })) };
    await expect(collectSmartHealth('/dev/sdh', { platform: 'linux', commandRunner: noCode })).resolves.toMatchObject({ available: false, exitCode: null, health: 'unknown' });
    await expect(collectSmartHealth('/dev/sdd', { platform: 'linux' })).resolves.toMatchObject({ available: false, reason: 'command runner unavailable' });
    await expect(collectSmartHealth()).resolves.toMatchObject({ available: false, reason: 'device path is not approved' });
    const thrown = { run: jest.fn(async () => { throw new Error('smart unavailable'); }) };
    await expect(collectSmartHealth('/dev/sde', { platform: 'linux', commandRunner: thrown })).resolves.toMatchObject({ available: false, reason: 'smart unavailable' });
  });
});

