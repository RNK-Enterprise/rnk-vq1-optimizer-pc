/**
 * Native system facts tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { collectBaseFacts, collectGpuFacts, collectSystemFacts } from '../native/system-facts.js';

const fakeOs = {
  cpus: () => [{ model: 'Test CPU' }, { model: 'Test CPU' }],
  totalmem: () => 1000,
  freemem: () => 250,
  loadavg: () => [1, 2, 3]
};

describe('native system facts', () => {
  test('collects bounded CPU and memory observations', () => {
    expect(collectBaseFacts({ platform: 'linux', osImpl: fakeOs })).toEqual(expect.objectContaining({
      platform: 'linux',
      cpu: { cores: 2, model: 'Test CPU', load1: 1, load5: 2, load15: 3 },
      memory: { totalBytes: 1000, freeBytes: 250, usedPercent: 75 },
      gpu: expect.objectContaining({ available: false })
    }));
    expect(collectBaseFacts({ osImpl: { cpus: () => [], totalmem: () => null, freemem: () => null, loadavg: () => [] } }).memory.usedPercent).toBeNull();
    expect(collectBaseFacts({ osImpl: {} }).cpu).toEqual(expect.objectContaining({ cores: null, model: null, load1: null }));
    expect(collectBaseFacts({ osImpl: { totalmem: () => 0, freemem: () => 1, cpus: () => [{ model: '' }], loadavg: () => [NaN, 'bad', null] } }).memory.usedPercent).toBeNull();
    expect(collectBaseFacts({ osImpl: { totalmem: () => 1, freemem: () => null } }).memory.usedPercent).toBeNull();
    expect(collectBaseFacts({ osImpl: { totalmem: () => Number.NaN, freemem: () => 1 } }).memory.usedPercent).toBeNull();
    expect(collectBaseFacts()).toEqual(expect.objectContaining({ platform: process.platform }));
  });

  test('reads NVIDIA facts only through the fixed query', async () => {
    const run = jest.fn().mockResolvedValue({ code: 0, stdout: '50, 8192, 1024, 65\n' });
    await expect(collectGpuFacts({ platform: 'linux', commandRunner: { run } })).resolves.toEqual({
      available: true,
      vendor: 'nvidia',
      utilizationPercent: 50,
      memoryUsedBytes: 1024 * 1024 ** 2,
      memoryTotalBytes: 8192 * 1024 ** 2,
      temperatureC: 65,
      thermalThrottling: null
    });
    expect(run).toHaveBeenCalledWith('nvidia-smi', expect.arrayContaining([
      '--query-gpu=utilization.gpu,memory.total,memory.used,temperature.gpu,clocks_throttle_reasons.hw_thermal_slowdown,clocks_throttle_reasons.sw_thermal_slowdown',
      '--format=csv,noheader,nounits'
    ]), { timeoutMs: 2500, maxOutputBytes: 2048 });
    await expect(collectGpuFacts({ platform: 'linux', commandRunner: { run: jest.fn().mockResolvedValue({ code: 0, stdout: '50,8192,1024,65,1,0' }) } })).resolves.toEqual(expect.objectContaining({ thermalThrottling: true }));
    await expect(collectGpuFacts({ platform: 'linux', commandRunner: { run: jest.fn().mockResolvedValue({ code: 0, stdout: '50,8192,1024,65,0,1' }) } })).resolves.toEqual(expect.objectContaining({ thermalThrottling: true }));
    await expect(collectGpuFacts({ platform: 'linux', commandRunner: { run: jest.fn().mockResolvedValue({ code: 0, stdout: '50,8192,1024,65,0,0' }) } })).resolves.toEqual(expect.objectContaining({ thermalThrottling: false }));
    await expect(collectGpuFacts({ platform: 'darwin', commandRunner: { run } })).resolves.toEqual(expect.objectContaining({ available: false }));
    await expect(collectGpuFacts({ platform: 'linux', commandRunner: { run: jest.fn().mockResolvedValue({ code: 1, stdout: '' }) } })).resolves.toEqual(expect.objectContaining({ available: false }));
    await expect(collectGpuFacts({ platform: 'linux', commandRunner: { run: jest.fn().mockResolvedValue({ code: 0, stdout: 'bad' }) } })).resolves.toEqual(expect.objectContaining({ available: false }));
    await expect(collectGpuFacts({ platform: 'linux', commandRunner: { run: jest.fn().mockResolvedValue({ code: 0, stdout: '1,2,3,x' }) } })).resolves.toEqual(expect.objectContaining({ available: false }));
    await expect(collectGpuFacts({ platform: 'linux', commandRunner: { run: jest.fn().mockRejectedValue(new Error('missing')) } })).resolves.toEqual(expect.objectContaining({ available: false }));
    await expect(collectGpuFacts()).resolves.toEqual(expect.objectContaining({ available: false }));
  });

  test('combines base and optional GPU facts', async () => {
    const facts = await collectSystemFacts({ platform: 'win32', osImpl: fakeOs, commandRunner: { run: async () => ({ code: 0, stdout: '1,2,3,4' }) } });
    expect(facts.platform).toBe('win32');
    expect(facts.gpu.available).toBe(true);
    expect((await collectSystemFacts()).platform).toBe(process.platform);
  });
});
