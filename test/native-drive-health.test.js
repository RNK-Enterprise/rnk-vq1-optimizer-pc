/**
 * Native drive health tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { collectDriveHealth, collectSmartHealth, collectSmartHealthForDrives, DRIVE_HEALTH_VERSION, parseDarwinDriveHealth, parseDarwinDriveInfo, parseLinuxDriveHealth, parseSmartOutput, parseWindowsDriveHealth } from '../native/drive-health.js';

describe('native drive health', () => {
  test('parses Windows, Linux, and macOS drive inventory evidence', () => {
    const windows = parseWindowsDriveHealth(JSON.stringify([{ FriendlyName: 'Fast SSD', SerialNumber: 's1', MediaType: 'SSD', Size: '100', HealthStatus: 'Healthy' }, { FriendlyName: 'Archive HDD', MediaType: 0, Size: 200, HealthStatus: 'Warning', MountPoint: 'E:' }, { DeviceID: 'PhysicalDrive2', MediaType: 'HDD', HealthStatus: 'Failed' }]));
    expect(windows).toMatchObject({ version: DRIVE_HEALTH_VERSION, available: true, drives: [{ mediaType: 'ssd', health: 'healthy' }, { mediaType: 'unknown', health: 'degraded', mountpoints: ['E:'] }, { mediaType: 'hdd', health: 'failed' }] });
    expect(parseWindowsDriveHealth(JSON.stringify([{ DiskNumber: 4, FriendlyName: 'Mapped SSD', HealthStatus: 'Healthy' }, { Number: 5, FriendlyName: 'Numbered' }, { Index: 6, FriendlyName: 'Indexed' }, { DiskNumber: null, Number: 7, FriendlyName: 'Fallback Number' }, { DiskNumber: 'bad', FriendlyName: 'Unmapped' }, { DiskNumber: -1, FriendlyName: 'Negative' }])).drives).toEqual(expect.arrayContaining([expect.objectContaining({ device: 'PhysicalDrive4', diskNumber: 4, physicalDevicePath: '\\\\.\\PhysicalDrive4' }), expect.objectContaining({ device: 'PhysicalDrive5', diskNumber: 5 }), expect.objectContaining({ device: 'PhysicalDrive6', diskNumber: 6 }), expect.objectContaining({ device: 'PhysicalDrive7', diskNumber: 7 }), expect.objectContaining({ device: null, diskNumber: null })]));
    const linux = parseLinuxDriveHealth(JSON.stringify({ blockdevices: [{ name: 'nvme0n1', type: 'disk', size: 1000, rota: false, model: 'NVMe', serial: 'n1', mountpoints: ['/'] }, { name: 'sda', type: 'disk', size: 2000, rota: true }, { name: 'sda1', type: 'part', size: 10, rota: true }] }));
    expect(linux.drives).toMatchObject([{ device: 'nvme0n1', mediaType: 'ssd', health: 'unknown', mountpoints: ['/'] }, { device: 'sda', mediaType: 'hdd' }]);
    const darwin = parseDarwinDriveHealth('/dev/disk0 (internal, physical):\n/dev/disk1 (external):');
    expect(darwin).toMatchObject({ available: true, drives: [{ device: '/dev/disk0', mediaType: 'hdd' }, { device: '/dev/disk1', mediaType: 'unknown' }] });
    expect(parseDarwinDriveInfo('<key>SolidState</key><true/><key>MediaName</key><string>Apple SSD</string><key>TotalSize</key><integer>500</integer>', darwin.drives[0])).toMatchObject({ mediaType: 'ssd', model: 'Apple SSD', sizeBytes: 500 });
    expect(parseDarwinDriveInfo('<key>SolidState</key><false/>', darwin.drives[0])).toMatchObject({ mediaType: 'hdd' });
    expect(parseDarwinDriveInfo('', darwin.drives[1])).toMatchObject({ mediaType: 'unknown', sizeBytes: null });
    expect(parseDarwinDriveInfo('', { model: null, mediaType: null, sizeBytes: 0 })).toMatchObject({ model: null, mediaType: 'unknown', sizeBytes: 0 });
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
    expect(windowsRunner.run.mock.calls[0][1].at(-1)).toEqual(expect.stringContaining('Get-Disk'));
    const darwinRunner = { run: jest.fn(async () => ({ code: 0, stdout: '/dev/disk0 (internal, physical):' })) };
    await expect(collectDriveHealth({ platform: 'darwin', commandRunner: darwinRunner })).resolves.toMatchObject({ available: true, drives: [{ device: '/dev/disk0' }] });
    const detailedDarwin = { run: jest.fn()
      .mockResolvedValueOnce({ code: 0, stdout: '/dev/disk0 (internal, physical):' })
      .mockResolvedValueOnce({ code: 0, stdout: '<key>SolidState</key><true/><key>MediaName</key><string>Apple SSD</string>' }) };
    await expect(collectDriveHealth({ platform: 'darwin', commandRunner: detailedDarwin })).resolves.toMatchObject({ drives: [{ mediaType: 'ssd', model: 'Apple SSD' }] });
    expect(detailedDarwin.run).toHaveBeenLastCalledWith('diskutil', ['info', '-plist', '/dev/disk0'], expect.any(Object));
    const unavailableDarwinInfo = { run: jest.fn()
      .mockResolvedValueOnce({ code: 0, stdout: '/dev/disk0 (internal, physical):' })
      .mockRejectedValueOnce(new Error('diskutil info unavailable')) };
    await expect(collectDriveHealth({ platform: 'darwin', commandRunner: unavailableDarwinInfo })).resolves.toMatchObject({ drives: [{ mediaType: 'hdd', model: 'internal, physical' }] });
    const failedDarwinInfo = { run: jest.fn()
      .mockResolvedValueOnce({ code: 0, stdout: '/dev/disk0 (internal, physical):' })
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'not supported' }) };
    await expect(collectDriveHealth({ platform: 'darwin', commandRunner: failedDarwinInfo })).resolves.toMatchObject({ drives: [{ mediaType: 'hdd', model: 'internal, physical' }] });
    const failure = { run: jest.fn(async () => ({ code: 1, stderr: 'denied' })) };
    await expect(collectDriveHealth({ platform: 'linux', commandRunner: failure })).resolves.toMatchObject({ available: false, reason: 'denied' });
    const bareFailure = { run: jest.fn(async () => ({ code: 1 })) };
    await expect(collectDriveHealth({ platform: 'linux', commandRunner: bareFailure })).resolves.toMatchObject({ available: false, reason: 'drive inventory command failed' });
    const badJson = { run: jest.fn(async () => ({ code: 0, stdout: '{bad}' })) };
    await expect(collectDriveHealth({ platform: 'win32', commandRunner: badJson })).resolves.toMatchObject({ available: false, source: 'Get-PhysicalDisk' });
  });

  test('validates SMART device paths and reports pass/fail/tool errors', async () => {
    const runner = { run: jest.fn(async (_command, args) => ({ code: args[2] === '/dev/sdb' ? 0 : 2, stdout: args[2] === '/dev/sdb' ? 'SMART overall-health self-assessment test result: PASSED\n194 Temperature_Celsius 0 0 0 0 35\nPercent_Lifetime_Remain 0 0 0 0 98\nPower_On_Hours 0 0 0 0 123\nUnsafe_Shutdowns 0 0 0 0 4\nCritical Warning: 0x00' : '', stderr: args[2] === '/dev/sdc' ? 'SMART overall-health self-assessment test result: FAILED\nPercentage Used: 5%' : '' })) };
    await expect(collectSmartHealth('../secret', { platform: 'linux', commandRunner: runner })).resolves.toMatchObject({ available: false, health: 'unknown' });
    await expect(collectSmartHealth('/dev/sdb', { platform: 'linux', commandRunner: runner })).resolves.toMatchObject({ available: true, health: 'healthy', temperatureC: 35, percentageUsed: 2, powerOnHours: 123, unsafeShutdowns: 4, criticalWarning: '0x00' });
    await expect(collectSmartHealth('/dev/sdc', { platform: 'linux', commandRunner: runner })).resolves.toMatchObject({ available: true, health: 'failed', percentageUsed: 5 });
    await expect(collectSmartHealth('\\\\.\\PhysicalDrive0', { platform: 'win32', commandRunner: runner })).resolves.toMatchObject({ available: false, health: 'unknown' });
    await expect(collectSmartHealth('/dev/sdf', { platform: 'linux', commandRunner: runner })).resolves.toMatchObject({ available: false, health: 'unknown' });
    const secondary = { run: jest.fn(async () => ({ code: 2, stdout: 'SMART Health Status: OK', stderr: '' })) };
    await expect(collectSmartHealth('/dev/sdg', { platform: 'linux', commandRunner: secondary })).resolves.toMatchObject({ available: true, health: 'healthy' });
    const noCode = { run: jest.fn(async () => ({ stdout: 'unrecognized device' })) };
    await expect(collectSmartHealth('/dev/sdh', { platform: 'linux', commandRunner: noCode })).resolves.toMatchObject({ available: false, exitCode: null, health: 'unknown', reason: 'SMART_UNAVAILABLE' });
    const invalidSmart = { run: jest.fn(async () => ({ code: 0, stdout: 'not SMART output', stderr: '' })) };
    await expect(collectSmartHealth('/dev/sdi', { platform: 'linux', commandRunner: invalidSmart })).resolves.toMatchObject({ available: false, health: 'unknown', reason: 'SMART_UNAVAILABLE' });
    await expect(collectSmartHealth('/dev/sdd', { platform: 'linux' })).resolves.toMatchObject({ available: false, reason: 'command runner unavailable' });
    await expect(collectSmartHealth()).resolves.toMatchObject({ available: false, reason: 'device path is not approved' });
    const thrown = { run: jest.fn(async () => { throw new Error('smart unavailable'); }) };
    await expect(collectSmartHealth('/dev/sde', { platform: 'linux', commandRunner: thrown })).resolves.toMatchObject({ available: false, reason: 'smart unavailable' });
    expect(parseSmartOutput('')).toEqual({ temperatureC: null, percentageUsed: null, powerOnHours: null, unsafeShutdowns: null, criticalWarning: null });
    expect(parseSmartOutput('Percent_Lifetime_Remain 98')).toMatchObject({ percentageUsed: 2 });
    expect(parseSmartOutput('Percent_Lifetime_Remain')).toMatchObject({ percentageUsed: 0 });
  });

  test('probes only bounded, normalized inventory devices when explicitly requested', async () => {
    const runner = { run: jest.fn(async (_command, args) => ({ code: 0, stdout: args[2].endsWith('sda') ? 'SMART Health Status: OK' : 'SMART overall-health self-assessment test result: PASSED', stderr: '' })) };
    const result = await collectSmartHealthForDrives([{ device: 'sda' }, { device: '/dev/sda' }, { device: 'sdb' }, { device: '../secret' }], { platform: 'linux', commandRunner: runner, maxDrives: 4 });
    expect(result).toMatchObject({ available: true, observedCount: 2, source: 'smartctl' });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(runner.run.mock.calls.map((call) => call[1][2])).toEqual(['/dev/sda', '/dev/sdb']);
    const windows = await collectSmartHealthForDrives([{ device: 'PhysicalDrive0' }, { device: '\\\\.\\PhysicalDrive1' }, { device: 'not-a-drive' }], { platform: 'win32', commandRunner: runner });
    expect(windows.observedCount).toBe(2);
    expect(runner.run.mock.calls.at(-2)[1][2]).toBe('\\\\.\\PhysicalDrive0');
    expect(runner.run.mock.calls.at(-1)[1][2]).toBe('\\\\.\\PhysicalDrive1');
    const unresolved = await collectSmartHealthForDrives([{ model: 'missing-index' }, { diskNumber: 3 }], { platform: 'win32', commandRunner: runner });
    expect(unresolved).toMatchObject({ available: true, observedCount: 1, unresolvedCount: 1, results: [expect.objectContaining({ state: 'SMART_DEVICE_UNRESOLVED' }), expect.objectContaining({ device: '\\\\.\\PhysicalDrive3' })] });
    await expect(collectSmartHealthForDrives(null)).rejects.toThrow('SMART drive inventory must be an array');
    await expect(collectSmartHealthForDrives([], { maxDrives: 0 })).rejects.toThrow('SMART drive limit is out of range');
    await expect(collectSmartHealthForDrives()).resolves.toMatchObject({ available: false, observedCount: 0 });
    await expect(collectSmartHealthForDrives([{}, { device: 'sda' }], { platform: 'freebsd', commandRunner: runner })).resolves.toMatchObject({ available: false, observedCount: 0 });
  });
});
