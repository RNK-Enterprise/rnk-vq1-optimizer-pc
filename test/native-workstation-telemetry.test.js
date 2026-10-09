/**
 * Native workstation telemetry tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import {
  collectBatteryTelemetry,
  collectFanTelemetry,
  collectNetworkTelemetry,
  collectProcessTelemetry,
  collectThermalTelemetry,
  collectWorkstationTelemetry,
  parseBatteryTelemetry,
  parseFanTelemetry,
  parseNetworkTelemetry,
  parseProcessTelemetry,
  parseThermalTelemetry,
  WORKSTATION_TELEMETRY_VERSION
} from '../native/workstation-telemetry.js';

function runner(result) { return { run: jest.fn(async () => result) }; }

function fakeFs(files, missing = new Set()) {
  return {
    readdir: jest.fn(async (file) => {
      if (missing.has(file)) throw new Error('unavailable');
      return files[file] || [];
    }),
    readFile: jest.fn(async (file) => {
      if (missing.has(file) || files[file] === undefined) throw new Error('unavailable');
      return files[file];
    }),
    readlink: jest.fn(async (file) => {
      if (missing.has(file) || files[file] === undefined) throw new Error('unavailable');
      return files[file];
    })
  };
}

describe('workstation process telemetry', () => {
  test('parses Windows JSON and bounded POSIX rows', () => {
    const windows = parseProcessTelemetry(JSON.stringify([
      { Id: 10, ProcessName: 'builder', Path: 'C:\\build\\builder.exe', WorkingSet64: 2048, CPU: 4, ReadTransferCount: 300, WriteTransferCount: 700, State: 'running', foreground: true, protected: true, role: 'build' },
      { Id: 11, ProcessName: '', WorkingSet64: 0, CPU: 0, StartTime: null }
    ]), { platform: 'win32' });
    expect(windows).toMatchObject({ available: true, truncated: false });
    expect(windows.processes[0]).toMatchObject({ pid: 10, name: 'builder', path: 'C:\\build\\builder.exe', memoryBytes: 2048, cpuSeconds: 4, ioReadBytes: 300, ioWriteBytes: 700, ioBytes: 1000, foreground: true, protected: true, role: 'build' });
    expect(windows.processes[1]).toMatchObject({ pid: 11, name: 'unknown', state: 'unknown' });
    expect(parseProcessTelemetry(JSON.stringify({ Id: 12, ProcessName: 'one' }), { platform: 'win32' }).processes).toHaveLength(1);
    expect(parseProcessTelemetry(JSON.stringify([
      { Id: 13, cpuSeconds: '3', rssKb: '4', role: '', state: '' },
      { pid: 0, name: 'invalid' }
    ]), { platform: 'win32' }).processes[0]).toMatchObject({ pid: 13, cpuSeconds: 3, memoryBytes: 4096 });
    expect(parseProcessTelemetry('{bad}', { platform: 'win32' })).toMatchObject({ available: false, processes: [] });
    const posix = parseProcessTelemetry('10 node 12.5 64 1-02:03:04 R\n11 shell bad 4 02:03 S\n12 shell 1 1 bad S\n13 shell 1 1 x-00:00:01 S\n14 short', { platform: 'linux' });
    expect(posix.processes[0]).toMatchObject({ pid: 10, memoryBytes: 64 * 1024, uptimeSeconds: 93784, state: 'R' });
    expect(posix.processes[0].role).toBe('developer');
    expect(posix.processes[1]).toMatchObject({ pid: 11, cpuPercent: null, uptimeSeconds: 123 });
    expect(posix.processes[2].uptimeSeconds).toBeNull();
    expect(posix.processes[3].uptimeSeconds).toBeNull();
    expect(parseProcessTelemetry('', { platform: 'linux' })).toMatchObject({ available: false, truncated: false });
    expect(parseProcessTelemetry()).toMatchObject({ available: false, processes: [] });
    const many = Array.from({ length: 513 }, (_, index) => `${index + 1} item 1 1 00:01 S`).join('\n');
    expect(parseProcessTelemetry(many, { platform: 'linux' }).truncated).toBe(true);
    const inferred = parseProcessTelemetry('20 ollama.exe 1 1 00:01 S\n21 wslhost 1 1 00:01 S\n22 unknown-tool 1 1 00:01 S', { platform: 'linux' });
    expect(inferred.processes.map((item) => item.role)).toEqual(['model', 'runtime', 'unknown']);
    expect(parseProcessTelemetry(JSON.stringify({ Id: 23, ProcessName: 'game', Path: 'E:\\SteamLibrary\\steamapps\\common\\Game\\game.exe' }), { platform: 'win32' }).processes[0]).toMatchObject({ role: 'game' });
    expect(parseProcessTelemetry(JSON.stringify({ Id: 24, ProcessName: 'writer', WriteTransferCount: 7 }), { platform: 'win32' }).processes[0]).toMatchObject({ ioReadBytes: null, ioWriteBytes: 7, ioBytes: null });
  });

  test('collects with fixed platform commands and fails closed', async () => {
    const win = runner({ code: 0, stdout: JSON.stringify({ Id: 1, ProcessName: 'one' }) });
    await expect(collectProcessTelemetry({ platform: 'win32', commandRunner: win })).resolves.toMatchObject({ available: true });
    expect(win.run.mock.calls[0][1].join(' ')).toEqual(expect.stringContaining('Get-Process'));
    expect(win.run.mock.calls[0][1].join(' ')).toEqual(expect.stringContaining('GetForegroundWindow'));
    expect(win.run.mock.calls[0][1].join(' ')).toEqual(expect.stringContaining('GetWindowThreadProcessId'));
    await expect(collectProcessTelemetry({ platform: 'linux', commandRunner: runner({ code: 0, stdout: '1 init 0 1 00:01 S' }), fsImpl: fakeFs({ '/proc/1/exe': '/usr/lib/init', '/proc/1/io': 'read_bytes: 300\nwrite_bytes: 700\n' }) })).resolves.toMatchObject({ available: true, processes: [{ path: '/usr/lib/init', ioReadBytes: 300, ioWriteBytes: 700, ioBytes: 1000 }] });
    await expect(collectProcessTelemetry({ platform: 'linux', commandRunner: runner({ code: 0, stdout: '2 game 0 1 00:01 S' }), fsImpl: fakeFs({ '/proc/2/exe': '/mnt/SteamLibrary/steamapps/common/Game/game', '/proc/2/io': 'read_bytes: 11\n' }) })).resolves.toMatchObject({ processes: [{ path: '/mnt/SteamLibrary/steamapps/common/Game/game', role: 'game', ioReadBytes: 11, ioWriteBytes: null, ioBytes: null }] });
    await expect(collectProcessTelemetry({ platform: 'linux', commandRunner: runner({ code: 0, stdout: '3 build 0 1 00:01 S' }), fsImpl: fakeFs({ '/proc/3/exe': '/usr/bin/build', '/proc/3/io': 'write_bytes: 7\n' }) })).resolves.toMatchObject({ processes: [{ path: '/usr/bin/build', role: 'unknown', ioReadBytes: null, ioWriteBytes: 7, ioBytes: null }] });
    await expect(collectProcessTelemetry({ platform: 'linux', commandRunner: runner({ code: 0, stdout: '4 build 0 1 00:01 S' }), fsImpl: fakeFs({ '/proc/4/exe': '/usr/bin/build', '/proc/4/io': '' }) })).resolves.toMatchObject({ processes: [{ path: '/usr/bin/build', ioReadBytes: null, ioWriteBytes: null, ioBytes: null }] });
    await expect(collectProcessTelemetry({ platform: 'linux', commandRunner: runner({ code: 0, stdout: '5 build 0 1 00:01 S' }), fsImpl: { readlink: jest.fn(async () => '/usr/bin/build') } })).resolves.toMatchObject({ processes: [{ path: '/usr/bin/build' }] });
    await expect(collectProcessTelemetry({ platform: 'linux', commandRunner: runner({ code: 0, stdout: '6 build 0 1 00:01 S' }), fsImpl: { readlink: jest.fn(async () => { throw new Error('gone'); }), readFile: jest.fn(async () => undefined) } })).resolves.toMatchObject({ processes: [{ path: null }] });
    await expect(collectProcessTelemetry({ platform: 'linux', commandRunner: runner({ code: 0, stdout: '7 node 0 1 00:01 S' }), fsImpl: fakeFs({ '/proc/7/exe': '/usr/bin/node', '/proc/7/io': 'read_bytes: 1\nwrite_bytes: 2\n' }) })).resolves.toMatchObject({ processes: [{ path: '/usr/bin/node', role: 'developer' }] });
    await expect(collectProcessTelemetry({ platform: 'darwin', commandRunner: runner({ code: 1, stderr: 'denied' }) })).resolves.toMatchObject({ available: false, reason: 'denied' });
    await expect(collectProcessTelemetry({ platform: 'win32', commandRunner: runner({ code: 1 }) })).resolves.toMatchObject({ available: false, reason: 'process command failed' });
    await expect(collectProcessTelemetry({ platform: 'linux', commandRunner: { run: jest.fn().mockRejectedValue(new Error('missing')) } })).resolves.toMatchObject({ available: false, reason: 'missing' });
    await expect(collectProcessTelemetry({ platform: 'linux', commandRunner: runner({ code: 0, stdout: '3 game 0 1 00:01 S' }), fsImpl: fakeFs({}, new Set(['/proc/3/exe'])) })).resolves.toMatchObject({ processes: [{ path: null, role: 'unknown' }] });
    await expect(collectProcessTelemetry({ platform: 'linux', commandRunner: runner({ code: 0, stdout: '4 game 0 1 00:01 S' }), fsImpl: {} })).resolves.toMatchObject({ processes: [{ path: null, role: 'unknown' }] });
    await expect(collectProcessTelemetry({ platform: 'freebsd', commandRunner: win })).resolves.toMatchObject({ available: false, reason: 'platform unsupported' });
    await expect(collectProcessTelemetry({ platform: 'linux' })).resolves.toMatchObject({ available: false, reason: 'command runner unavailable' });
    await expect(collectProcessTelemetry()).resolves.toMatchObject({ available: false, reason: 'command runner unavailable' });
  });
});

describe('workstation battery telemetry', () => {
  test('parses Windows, macOS, invalid, and sysfs battery evidence', () => {
    const windows = parseBatteryTelemetry(JSON.stringify({ Name: 'BAT0', Status: 'charging', EstimatedChargeRemaining: 120, DesignCapacity: 100, FullChargeCapacity: 80, CycleCount: 4 }), { platform: 'win32' });
    expect(windows.batteries[0]).toMatchObject({ capacityPercent: 100, healthPercent: 80, cycleCount: 4 });
    const variants = parseBatteryTelemetry(JSON.stringify([
      { name: 'a', status: 'ok', designCapacity: 10, fullCapacity: 5, capacity: 4, cycleCount: 1 },
      { Name: 'b', Status: 'ok', DesignedCapacity: 10, energyFull: 8, EstimatedChargeRemaining: 4, CycleCount: 2 },
      { name: '', status: '', energyFullDesign: 10, energyFull: 9, capacity: 'bad' },
      { DesignCapacity: 0, FullChargeCapacity: 1 },
      {}
    ]), { platform: 'unknown' });
    expect(variants.batteries).toHaveLength(5);
    expect(variants.batteries[0]).toMatchObject({ healthPercent: 50, cycleCount: 1 });
    expect(variants.batteries[1]).toMatchObject({ healthPercent: 80, cycleCount: 2 });
    expect(variants.batteries[2]).toMatchObject({ healthPercent: 90, name: 'battery', status: 'unknown' });
    expect(parseBatteryTelemetry()).toMatchObject({ available: false, batteries: [] });
    expect(parseBatteryTelemetry('Now drawing from AC\n 80%', { platform: 'darwin' })).toMatchObject({ available: true, batteries: [{ status: 'discharging', capacityPercent: 80 }] });
    expect(parseBatteryTelemetry('Now drawing from AC\n 80%; charging', { platform: 'darwin' })).toMatchObject({ available: true, batteries: [{ status: 'charging' }] });
    expect(parseBatteryTelemetry(undefined, { platform: 'darwin' })).toMatchObject({ available: false, batteries: [] });
    expect(parseBatteryTelemetry('no battery', { platform: 'darwin' })).toMatchObject({ available: false, batteries: [] });
    expect(parseBatteryTelemetry('{bad}', { platform: 'win32' })).toMatchObject({ available: false, batteries: [] });
  });

  test('reads Linux power-supply files and handles unavailable sources', async () => {
    const files = {
      '/sys/class/power_supply': ['BAT0', 'AC', 'BAT1', 'BAT2'],
      '/sys/class/power_supply/BAT0/type': 'Battery',
      '/sys/class/power_supply/BAT0/status': 'Charging',
      '/sys/class/power_supply/BAT0/capacity': '88',
      '/sys/class/power_supply/BAT0/energy_full': '800',
      '/sys/class/power_supply/BAT0/energy_full_design': '1000',
      '/sys/class/power_supply/BAT0/cycle_count': '4',
      '/sys/class/power_supply/BAT1/type': 'Mains'
    };
    const fsImpl = fakeFs(files, new Set(['/sys/class/power_supply/BAT0/cycle_count', '/sys/class/power_supply/BAT2/type']));
    const facts = await collectBatteryTelemetry({ platform: 'linux', fsImpl });
    expect(facts).toMatchObject({ available: true, source: 'sysfs' });
    expect(facts.batteries[0]).toMatchObject({ capacityPercent: 88, healthPercent: 80, cycleCount: null });
    expect(facts.batteries).toHaveLength(2);
    await expect(collectBatteryTelemetry({ platform: 'linux', fsImpl: fakeFs({}, new Set(['/sys/class/power_supply'])) })).resolves.toMatchObject({ available: false });
  });

  test('uses fixed Windows and macOS commands and refuses unknown platforms', async () => {
    const win = runner({ code: 0, stdout: JSON.stringify({ EstimatedChargeRemaining: 50 }) });
    await expect(collectBatteryTelemetry({ platform: 'win32', commandRunner: win })).resolves.toMatchObject({ available: true });
    const windowsCommand = win.run.mock.calls[0][1].join(' ');
    expect(windowsCommand).toEqual(expect.stringContaining('BatteryStaticData'));
    expect(windowsCommand).toEqual(expect.stringContaining('BatteryFullChargedCapacity'));
    expect(windowsCommand).toEqual(expect.stringContaining('BatteryCycleCount'));
    await expect(collectBatteryTelemetry({ platform: 'darwin', commandRunner: runner({ code: 0, stdout: '75%' }) })).resolves.toMatchObject({ available: true });
    await expect(collectBatteryTelemetry({ platform: 'win32', commandRunner: runner({ code: 1, stderr: 'denied' }) })).resolves.toMatchObject({ source: 'denied' });
    await expect(collectBatteryTelemetry({ platform: 'darwin', commandRunner: { run: jest.fn().mockRejectedValue(new Error('missing')) } })).resolves.toMatchObject({ source: 'missing' });
    await expect(collectBatteryTelemetry({ platform: 'freebsd', commandRunner: win })).resolves.toMatchObject({ source: 'platform unsupported' });
    await expect(collectBatteryTelemetry({ platform: 'win32' })).resolves.toMatchObject({ source: 'command runner unavailable' });
    await expect(collectBatteryTelemetry({ platform: 'win32', commandRunner: runner({ code: 1 }) })).resolves.toMatchObject({ source: 'battery command failed' });
    await expect(collectBatteryTelemetry()).resolves.toHaveProperty('batteries');
  });
});

describe('workstation thermal telemetry', () => {
  test('normalizes JSON and line-based temperatures', () => {
    const jsonFacts = parseThermalTelemetry(JSON.stringify([
      { InstanceName: 'zone0', CurrentTemperature: 3000 },
      { InstanceName: 'zone-null', CurrentTemperature: null },
      { type: 'cpu', temp: '45000' },
      { type: 'ssd', temp: '75' },
      { type: 'bad', temp: 'nope' }
    ]), { platform: 'win32' });
    expect(jsonFacts).toMatchObject({ available: true, maxTemperatureC: 75 });
    expect(parseThermalTelemetry(JSON.stringify([{ temp: 70 }]), { platform: 'linux' }).zones[0]).toMatchObject({ name: 'thermal-zone', temperatureC: 70 });
    const textFacts = parseThermalTelemetry('cpu: 65\ninvalid', { platform: 'linux' });
    expect(textFacts).toMatchObject({ available: true, zones: [{ name: 'cpu', temperatureC: 65 }] });
    expect(parseThermalTelemetry('', { platform: 'linux' })).toMatchObject({ available: false, zones: [], maxTemperatureC: null });
    expect(parseThermalTelemetry()).toMatchObject({ available: false, zones: [] });
  });

  test('reads Linux zones and fixed Windows telemetry', async () => {
    const files = {
      '/sys/class/thermal': ['thermal_zone0', 'thermal_zone1', 'cooling_device0'],
      '/sys/class/thermal/thermal_zone0/temp': '51000',
      '/sys/class/thermal/thermal_zone0/type': 'cpu'
    };
    const linux = await collectThermalTelemetry({ platform: 'linux', fsImpl: fakeFs(files, new Set(['/sys/class/thermal/thermal_zone1/temp'])) });
    expect(linux).toMatchObject({ available: true, maxTemperatureC: 51, thermalThrottling: null, throttleEvents: null, source: 'sysfs' });
    const throttledFiles = {
      '/sys/class/thermal': [],
      '/sys/devices/system/cpu': ['cpu0', 'cpu1', 'not-a-cpu'],
      '/sys/devices/system/cpu/cpu0/thermal_throttle/package_throttle_count': '2',
      '/sys/devices/system/cpu/cpu0/thermal_throttle/core_throttle_count': '0',
      '/sys/devices/system/cpu/cpu1/thermal_throttle/package_throttle_count': 'bad',
      '/sys/devices/system/cpu/cpu1/thermal_throttle/core_throttle_count': '3'
    };
    await expect(collectThermalTelemetry({ platform: 'linux', fsImpl: fakeFs(throttledFiles) })).resolves.toMatchObject({ thermalThrottling: true, throttleEvents: 5 });
    const stableFiles = { '/sys/class/thermal': [], '/sys/devices/system/cpu': ['cpu0'], '/sys/devices/system/cpu/cpu0/thermal_throttle/package_throttle_count': '0', '/sys/devices/system/cpu/cpu0/thermal_throttle/core_throttle_count': '0' };
    await expect(collectThermalTelemetry({ platform: 'linux', fsImpl: fakeFs(stableFiles) })).resolves.toMatchObject({ thermalThrottling: false, throttleEvents: 0 });
    await expect(collectThermalTelemetry({ platform: 'linux', fsImpl: fakeFs({ '/sys/class/thermal': [] }, new Set(['/sys/devices/system/cpu'])) })).resolves.toMatchObject({ thermalThrottling: null, throttleEvents: null });
    await expect(collectThermalTelemetry({ platform: 'linux', fsImpl: fakeFs({}, new Set(['/sys/class/thermal'])) })).resolves.toMatchObject({ available: false });
    await expect(collectThermalTelemetry({ platform: 'win32', commandRunner: runner({ code: 0, stdout: JSON.stringify({ InstanceName: 'zone', CurrentTemperature: 3000 }) }) })).resolves.toMatchObject({ available: true, source: 'MSAcpi_ThermalZoneTemperature' });
    await expect(collectThermalTelemetry({ platform: 'win32', commandRunner: runner({ code: 1, stderr: 'denied' }) })).resolves.toMatchObject({ source: 'denied' });
    await expect(collectThermalTelemetry({ platform: 'win32', commandRunner: { run: jest.fn().mockRejectedValue(new Error('missing')) } })).resolves.toMatchObject({ source: 'missing' });
    await expect(collectThermalTelemetry({ platform: 'darwin', commandRunner: runner({ code: 0 }) })).resolves.toMatchObject({ source: 'platform unsupported' });
    await expect(collectThermalTelemetry({ platform: 'win32' })).resolves.toMatchObject({ source: 'command runner unavailable' });
    await expect(collectThermalTelemetry({ platform: 'win32', commandRunner: runner({ code: 1 }) })).resolves.toMatchObject({ source: 'thermal command failed' });
    await expect(collectThermalTelemetry()).resolves.toHaveProperty('zones');
  });
});

describe('workstation fan telemetry', () => {
  test('parses fixed Windows fan evidence and rejects unsupported rows', () => {
    expect(parseFanTelemetry(JSON.stringify([{ Name: 'CPU fan', CurrentSpeed: 2400 }, { rpm: 1200, label: 'GPU fan' }, { speed: 900, label: '' }, { Name: 'bad', CurrentSpeed: 'bad' }]), { platform: 'win32' })).toMatchObject({ available: true, fans: [{ name: 'CPU fan', rpm: 2400 }, { name: 'GPU fan', rpm: 1200 }, { name: 'fan', rpm: 900 }], source: 'Win32_Fan' });
    expect(parseFanTelemetry()).toMatchObject({ available: false, fans: [] });
  });

  test('reads bounded Linux hwmon fan inputs and fails closed', async () => {
    const files = {
      '/sys/class/hwmon': ['hwmon0', 'not-hwmon'],
      '/sys/class/hwmon/hwmon0': ['name', 'fan1_input', 'fan2_input', 'temp1_input'],
      '/sys/class/hwmon/hwmon0/name': 'asus',
      '/sys/class/hwmon/hwmon0/fan1_input': '2400',
      '/sys/class/hwmon/hwmon0/fan2_input': 'bad'
    };
    expect(await collectFanTelemetry({ platform: 'linux', fsImpl: fakeFs(files) })).toMatchObject({ available: true, fans: [{ name: 'asus', rpm: 2400 }], source: 'hwmon' });
    const missingDirectory = await collectFanTelemetry({ platform: 'linux', fsImpl: fakeFs({ '/sys/class/hwmon': ['hwmon0'] }, new Set(['/sys/class/hwmon/hwmon0'])) });
    expect(missingDirectory).toMatchObject({ available: false, fans: [], source: 'hwmon' });
    const missingLabel = await collectFanTelemetry({ platform: 'linux', fsImpl: fakeFs({ '/sys/class/hwmon': ['hwmon0'], '/sys/class/hwmon/hwmon0': ['name', 'fan1_input'], '/sys/class/hwmon/hwmon0/name': '', '/sys/class/hwmon/hwmon0/fan1_input': '1000' }) });
    expect(missingLabel.fans[0]).toMatchObject({ name: 'hwmon0', rpm: 1000 });
    await expect(collectFanTelemetry({ platform: 'linux', fsImpl: fakeFs({}, new Set(['/sys/class/hwmon'])) })).resolves.toMatchObject({ available: false });
    await expect(collectFanTelemetry({ platform: 'darwin', commandRunner: runner({ code: 0 }) })).resolves.toMatchObject({ available: false, source: 'platform unsupported' });
    await expect(collectFanTelemetry({ platform: 'win32', commandRunner: runner({ code: 0, stdout: JSON.stringify({ Name: 'fan', CurrentSpeed: 1800 }) }) })).resolves.toMatchObject({ available: true, fans: [{ rpm: 1800 }] });
    await expect(collectFanTelemetry({ platform: 'win32', commandRunner: runner({ code: 1, stderr: 'denied' }) })).resolves.toMatchObject({ available: false, source: 'denied' });
    await expect(collectFanTelemetry({ platform: 'win32', commandRunner: { run: jest.fn().mockRejectedValue(new Error('missing')) } })).resolves.toMatchObject({ source: 'missing' });
    await expect(collectFanTelemetry({ platform: 'win32' })).resolves.toMatchObject({ source: 'command runner unavailable' });
    await expect(collectFanTelemetry()).resolves.toHaveProperty('fans');
  });
});

describe('workstation network telemetry', () => {
  test('parses platform-specific interface counters', () => {
    const windows = parseNetworkTelemetry(JSON.stringify({ Name: 'Ethernet', ReceivedBytes: 10, SentBytes: 20, State: 'Up' }), { platform: 'win32' });
    expect(windows.interfaces[0]).toMatchObject({ name: 'Ethernet', receivedBytes: 10, sentBytes: 20, state: 'Up' });
    expect(parseNetworkTelemetry(JSON.stringify({}), { platform: 'win32' }).interfaces[0]).toMatchObject({ name: 'unknown', state: 'unknown' });
    expect(parseNetworkTelemetry('eth0: 1 2 3 4 5 6 7 8 9', { platform: 'linux' }).interfaces[0]).toMatchObject({ name: 'eth0', receivedBytes: 1, sentBytes: 9 });
    expect(parseNetworkTelemetry('Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nen0 1500 <Link#1> aa 10 0 100 20 0 200 0', { platform: 'darwin' })).toMatchObject({ available: true, interfaces: [{ name: 'en0', receivedBytes: 100, sentBytes: 200 }] });
    expect(parseNetworkTelemetry('Name Mtu Network\nen0 1500 local', { platform: 'darwin' })).toMatchObject({ available: false, interfaces: [] });
    expect(parseNetworkTelemetry('{bad}', { platform: 'win32' })).toMatchObject({ available: false, interfaces: [] });
    expect(parseNetworkTelemetry('', { platform: 'linux' })).toMatchObject({ available: false, interfaces: [] });
    expect(parseNetworkTelemetry()).toMatchObject({ available: false, interfaces: [] });
  });

  test('collects fixed commands or bounded proc data', async () => {
    await expect(collectNetworkTelemetry({ platform: 'linux', fsImpl: fakeFs({ '/proc/net/dev': 'eth0: 1 0 0 0 0 0 0 0 2' }) })).resolves.toMatchObject({ available: true });
    await expect(collectNetworkTelemetry({ platform: 'linux', fsImpl: fakeFs({}, new Set(['/proc/net/dev'])) })).resolves.toMatchObject({ source: 'proc unavailable' });
    await expect(collectNetworkTelemetry({ platform: 'win32', commandRunner: runner({ code: 0, stdout: JSON.stringify({ Name: 'Wi-Fi', ReceivedBytes: 1, SentBytes: 2 }) }) })).resolves.toMatchObject({ available: true });
    await expect(collectNetworkTelemetry({ platform: 'win32', commandRunner: runner({ code: 1, stderr: 'denied' }) })).resolves.toMatchObject({ source: 'denied' });
    await expect(collectNetworkTelemetry({ platform: 'darwin', commandRunner: runner({ code: 0, stdout: 'Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nen0 1500 <Link#1> aa 10 0 100 20 0 200 0' }) })).resolves.toMatchObject({ available: true, interfaces: [{ receivedBytes: 100, sentBytes: 200 }] });
    await expect(collectNetworkTelemetry({ platform: 'darwin', commandRunner: { run: jest.fn().mockRejectedValue(new Error('missing')) } })).resolves.toMatchObject({ source: 'missing' });
    await expect(collectNetworkTelemetry({ platform: 'freebsd', commandRunner: runner({ code: 0 }) })).resolves.toMatchObject({ source: 'platform unsupported' });
    await expect(collectNetworkTelemetry({ platform: 'win32' })).resolves.toMatchObject({ source: 'command runner unavailable' });
    await expect(collectNetworkTelemetry({ platform: 'win32', commandRunner: runner({ code: 1 }) })).resolves.toMatchObject({ source: 'network command failed' });
    await expect(collectNetworkTelemetry()).resolves.toHaveProperty('interfaces');
  });
});

test('collects the bounded telemetry envelope without granting authority', async () => {
  const facts = await collectWorkstationTelemetry({ platform: 'linux', fsImpl: fakeFs({ '/proc/net/dev': 'eth0: 1 0 0 0 0 0 0 0 2', '/sys/class/power_supply': [], '/sys/class/thermal': [] }) });
  expect(facts).toMatchObject({ telemetryVersion: WORKSTATION_TELEMETRY_VERSION, platform: 'linux', processes: { available: false }, battery: { available: false }, thermals: { available: false }, network: { available: true } });
  expect(facts.processes.processes).toEqual([]);
  await expect(collectWorkstationTelemetry()).resolves.toHaveProperty('telemetryVersion', WORKSTATION_TELEMETRY_VERSION);
});
