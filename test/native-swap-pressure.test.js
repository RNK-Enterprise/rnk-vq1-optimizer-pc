/**
 * Native Linux swap pressure tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { collectDarwinSwapPressure, collectLinuxSwapPressure, parseDarwinSwapOutput, parseLinuxSwapOutput } from '../native/swap-pressure.js';

describe('native Linux swap pressure', () => {
  test('parses valid system-managed swap facts and clamps impossible pressure', () => {
    expect(parseLinuxSwapOutput('               total        used        free\nSwap:       1000         250         750\n')).toMatchObject({
      available: true,
      systemManaged: true,
      allocatedBytes: 1000,
      currentBytes: 250,
      pressurePercent: 25,
      cleanup: 'never'
    });
    expect(parseLinuxSwapOutput('Swap: 100 200 0')).toMatchObject({ pressurePercent: 100 });
    expect(parseLinuxSwapOutput('Swap: 0 0 0')).toMatchObject({ available: true, pressurePercent: null });
  });

  test('rejects missing, malformed, and negative swap facts', () => {
    expect(parseLinuxSwapOutput()).toBeNull();
    expect(parseLinuxSwapOutput('Mem: 100 50 50')).toBeNull();
    expect(parseLinuxSwapOutput('Swap: 100')).toBeNull();
    expect(parseLinuxSwapOutput('Swap: bad 1 2')).toBeNull();
    expect(parseLinuxSwapOutput('Swap: -1 1 0')).toBeNull();
    expect(parseLinuxSwapOutput('Swap: 1 -1 0')).toBeNull();
  });

  test('parses macOS swapusage units and rejects incomplete facts', () => {
    expect(parseDarwinSwapOutput('total = 4.00G used = 1.00G free = 3.00G')).toMatchObject({
      available: true, allocatedBytes: 4 * 1024 ** 3, currentBytes: 1024 ** 3, pressurePercent: 25, cleanup: 'never'
    });
    expect(parseDarwinSwapOutput('total = 4096 used = 1024')).toMatchObject({ allocatedBytes: 4096, currentBytes: 1024 });
    expect(parseDarwinSwapOutput('total = 0M used = 0M')).toMatchObject({ available: true, pressurePercent: null });
    expect(parseDarwinSwapOutput()).toBeNull();
    expect(parseDarwinSwapOutput('total = 4G free = 4G')).toBeNull();
    expect(parseDarwinSwapOutput('total = badG used = 1G')).toBeNull();
    expect(parseDarwinSwapOutput('total = 4Q used = 1G')).toBeNull();
  });

  test('runs the fixed shell-free Linux collector and fails closed', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ code: 0, stdout: 'Swap: 400 100 300\n' }) };
    await expect(collectLinuxSwapPressure({ commandRunner: runner })).resolves.toMatchObject({
      available: true, allocatedBytes: 400, currentBytes: 100, pressurePercent: 25, cleanup: 'never'
    });
    expect(runner.run).toHaveBeenCalledWith('free', ['-b'], { timeoutMs: 2500, maxOutputBytes: 4096 });
    await expect(collectLinuxSwapPressure()).resolves.toMatchObject({ available: false, cleanup: 'never' });
    await expect(collectLinuxSwapPressure({ commandRunner: { run: jest.fn().mockResolvedValue({ code: 1 }) } })).resolves.toMatchObject({ available: false });
    await expect(collectLinuxSwapPressure({ commandRunner: { run: jest.fn().mockResolvedValue({ code: 0, stdout: 'bad' }) } })).resolves.toMatchObject({ available: false });
    await expect(collectLinuxSwapPressure({ commandRunner: { run: jest.fn().mockRejectedValue(new Error('missing')) } })).resolves.toMatchObject({ available: false });
    const macRunner = { run: jest.fn().mockResolvedValue({ code: 0, stdout: 'total = 2G used = 1G free = 1G' }) };
    await expect(collectDarwinSwapPressure({ commandRunner: macRunner })).resolves.toMatchObject({ available: true, pressurePercent: 50, cleanup: 'never' });
    expect(macRunner.run).toHaveBeenCalledWith('sysctl', ['-n', 'vm.swapusage'], { timeoutMs: 2500, maxOutputBytes: 4096 });
    await expect(collectDarwinSwapPressure()).resolves.toMatchObject({ available: false });
    await expect(collectDarwinSwapPressure({ commandRunner: { run: jest.fn().mockResolvedValue({ code: 1 }) } })).resolves.toMatchObject({ available: false });
    await expect(collectDarwinSwapPressure({ commandRunner: { run: jest.fn().mockResolvedValue({ code: 0, stdout: 'bad' }) } })).resolves.toMatchObject({ available: false });
    await expect(collectDarwinSwapPressure({ commandRunner: { run: jest.fn().mockRejectedValue(new Error('missing')) } })).resolves.toMatchObject({ available: false });
  });
});
