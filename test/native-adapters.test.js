/**
 * Native Windows and Linux adapter tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { createLinuxAdapter } from '../native/linux-adapter.js';
import { createWindowsAdapter } from '../native/windows-adapter.js';
import { createMacosAdapter } from '../native/macos-adapter.js';
import { createPlatformAdapter } from '../native/platform.js';

const valid = {
  power: { type: 'set-power-profile', key: 'power.profile', value: 'performance' },
  priority: { type: 'set-process-priority', key: 'process.priority', value: 'high' },
  io: { type: 'set-process-io-priority', key: 'process.io', value: 'low' },
  affinity: { type: 'set-process-affinity', key: 'process.affinity', value: 'performance' },
  cpuLimit: { type: 'set-process-resource-limit', key: 'process.resource-limit', value: 'cpu-percent', limit: 50 },
  memoryLimit: { type: 'set-process-resource-limit', key: 'process.resource-limit', value: 'memory-bytes', limit: 1024 * 1024 * 1024 },
  gpu: { type: 'set-gpu-policy', key: 'gpu.policy', value: 'performance' },
  memory: { type: 'set-memory-policy', key: 'memory.policy', value: 'background-low' },
  cache: { type: 'clear-cache', key: 'cache', value: 'user-temp' },
  stop: { type: 'stop-approved-process', key: 'process.stop', value: 'background-approved' }
};

function harness() {
  const calls = [];
  const commandRunner = { run: jest.fn(async (...args) => { calls.push(args); return { code: 0, stderr: '' }; }) };
  const cacheCleaner = {
    preview: jest.fn(async (input) => ({ ...input, roots: [], items: [] })),
    clean: jest.fn(async () => ({ ok: true, removed: [] }))
  };
  const fsImpl = { readFile: jest.fn(async () => { throw new Error('cgroup unavailable'); }), mkdir: jest.fn(), writeFile: jest.fn() };
  return { calls, commandRunner, cacheCleaner, fsImpl };
}

describe('native adapters', () => {
  test('Windows runs only fixed supported actions and gates process stops', async () => {
    const h = harness();
    const adapter = createWindowsAdapter(h);
    expect(adapter.platform).toBe('win32');
    expect(adapter.requiresAdmin(valid.stop)).toBe(true);
    expect(adapter.requiresAdmin(valid.affinity)).toBe(true);
    expect(adapter.requiresAdmin(valid.cpuLimit)).toBe(true);
    expect(adapter.requiresAdmin(valid.power)).toBe(false);
    expect((await adapter.applyAction(valid.power)).ok).toBe(true);
    expect((await adapter.applyAction(valid.priority, { targetPid: 123 })).ok).toBe(true);
    expect((await adapter.applyAction({ ...valid.priority, value: 'low' }, { targetPid: 123 })).ok).toBe(true);
    expect((await adapter.applyAction(valid.affinity, { targetPid: 123 })).ok).toBe(true);
    expect((await adapter.applyAction(valid.cpuLimit, { targetPid: 123 })).ok).toBe(true);
    expect((await adapter.applyAction(valid.memoryLimit, { targetPid: 123 })).ok).toBe(true);
    expect((await adapter.applyAction({ ...valid.cpuLimit, limit: 101 }, { targetPid: 123 })).ok).toBe(false);
    expect((await adapter.applyAction({ type: 'set-process-resource-limit' }, { targetPid: 123 })).ok).toBe(false);
    expect((await adapter.applyAction({ ...valid.memoryLimit, limit: 1 }, { targetPid: 123 })).ok).toBe(false);
    expect((await adapter.applyAction({ ...valid.memoryLimit, limit: 2 ** 41 }, { targetPid: 123 })).ok).toBe(false);
    expect((await adapter.applyAction(valid.cpuLimit, { targetPid: 0 })).ok).toBe(false);
    expect((await adapter.applyAction(valid.cache, { approved: true })).ok).toBe(true);
    expect((await adapter.applyAction(valid.stop, { targetPid: 123, allowProcessStop: true, approvedBackgroundPids: [123] })).ok).toBe(true);
    expect((await adapter.applyAction(valid.stop, { targetPid: 123, allowProcessStop: false, approvedBackgroundPids: [123] })).ok).toBe(false);
    expect((await adapter.applyAction(valid.stop, { targetPid: 123, allowProcessStop: true, approvedBackgroundPids: new Set([123]) })).ok).toBe(true);
    expect((await adapter.applyAction(valid.stop, { targetPid: 123, allowProcessStop: true, approvedBackgroundPids: [123] })).ok).toBe(true);
    expect((await adapter.applyAction(valid.stop, { targetPid: 123, allowProcessStop: true, approvedBackgroundPids: {} })).ok).toBe(false);
    expect((await adapter.applyAction(valid.stop, { targetPid: 123, allowProcessStop: true, approvedBackgroundPids: {} })).ok).toBe(false);
    expect((await adapter.applyAction(valid.priority, { targetPid: null })).ok).toBe(false);
    expect((await adapter.applyAction({ type: 'unknown' })).ok).toBe(false);
    h.commandRunner.run.mockResolvedValue({ code: 1, stderr: 'denied' });
    await expect(adapter.applyAction({ ...valid.priority, value: 'low' }, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'denied' });
    h.commandRunner.run.mockResolvedValue({ code: 1 });
    await expect(adapter.applyAction({ ...valid.priority, value: 'low' }, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'set-process-priority failed' });
    for (const action of [valid.io, valid.gpu, valid.memory]) expect((await adapter.applyAction(action)).ok).toBe(false);
    expect(h.calls[0]).toEqual(['powercfg.exe', ['/setactive', '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c']]);
    await expect(adapter.collectFacts()).resolves.toEqual(expect.objectContaining({ platform: 'win32' }));
  });

  test('Linux runs fixed power/process/cache controls and separates admin work', async () => {
    const h = harness();
    const adapter = createLinuxAdapter(h);
    expect(adapter.requiresAdmin(valid.power)).toBe(true);
    expect(adapter.requiresAdmin(valid.priority)).toBe(true);
    expect(adapter.requiresAdmin(valid.affinity)).toBe(true);
    expect(adapter.requiresAdmin(valid.io)).toBe(false);
    expect((await adapter.applyAction({ ...valid.power, value: 'battery' })).ok).toBe(true);
    expect((await adapter.applyAction({ ...valid.priority, value: 'low' }, { targetPid: 123 })).ok).toBe(true);
    expect((await adapter.applyAction(valid.io, { targetPid: 123 })).ok).toBe(true);
    expect((await adapter.applyAction(valid.affinity, { targetPid: 123 })).ok).toBe(true);
    expect(adapter.requiresAdmin(valid.memoryLimit)).toBe(true);
    expect(adapter.requiresAdmin(valid.cpuLimit)).toBe(true);
    expect((await adapter.applyAction(valid.memoryLimit, { targetPid: 123 })).ok).toBe(true);
    expect((await adapter.applyAction(valid.cpuLimit, { targetPid: 123 })).ok).toBe(false);
    const cgroupFs = { readFile: jest.fn(async () => 'cpu memory'), mkdir: jest.fn(async () => {}), writeFile: jest.fn(async () => {}) };
    const cgroupAdapter = createLinuxAdapter({ ...h, fsImpl: cgroupFs, cgroupRoot: '/test-cgroup' });
    await expect(cgroupAdapter.applyAction(valid.cpuLimit, { targetPid: 123 })).resolves.toMatchObject({ ok: true, mechanism: 'cgroup-v2', group: '/test-cgroup/rnk-optimizer-123', quota: 50000, period: 100000 });
    await expect(cgroupAdapter.applyAction({ ...valid.cpuLimit, limit: 1 }, { targetPid: 123 })).resolves.toMatchObject({ ok: true, quota: 1000 });
    await expect(cgroupAdapter.applyAction(valid.memoryLimit, { targetPid: 123 })).resolves.toMatchObject({ ok: true, mechanism: 'cgroup-v2', limit: valid.memoryLimit.limit });
    expect(cgroupFs.writeFile).toHaveBeenCalledWith('/test-cgroup/rnk-optimizer-123/cpu.max', '50000 100000');
    expect(cgroupFs.writeFile).toHaveBeenCalledWith('/test-cgroup/rnk-optimizer-123/memory.max', String(valid.memoryLimit.limit));
    expect(cgroupFs.writeFile).toHaveBeenCalledWith('/test-cgroup/rnk-optimizer-123/cgroup.procs', '123');
    const noCpu = createLinuxAdapter({ ...h, fsImpl: { readFile: jest.fn(async () => 'memory'), mkdir: jest.fn(), writeFile: jest.fn() }, cgroupRoot: '/test-cgroup' });
    await expect(noCpu.applyAction(valid.cpuLimit, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'Linux cgroup CPU controller is unavailable' });
    const writeFailure = createLinuxAdapter({ ...h, fsImpl: { readFile: jest.fn(async () => 'cpu'), mkdir: jest.fn(async () => {}), writeFile: jest.fn(async () => { throw new Error('write denied'); }) }, cgroupRoot: '/test-cgroup' });
    await expect(writeFailure.applyAction(valid.cpuLimit, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'write denied' });
    const unknownFailure = createLinuxAdapter({ ...h, fsImpl: { readFile: jest.fn(async () => 'cpu'), mkdir: jest.fn(async () => {}), writeFile: jest.fn(async () => { throw {}; }) }, cgroupRoot: '/test-cgroup' });
    await expect(unknownFailure.applyAction(valid.cpuLimit, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'Linux cgroup CPU limit failed' });
    const memoryFailure = createLinuxAdapter({ ...h, fsImpl: { readFile: jest.fn(async () => 'memory'), mkdir: jest.fn(async () => {}), writeFile: jest.fn(async () => { throw new Error('memory write denied'); }) }, cgroupRoot: '/test-cgroup' });
    await expect(memoryFailure.applyAction(valid.memoryLimit, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'memory write denied' });
    const unknownMemoryFailure = createLinuxAdapter({ ...h, fsImpl: { readFile: jest.fn(async () => 'memory'), mkdir: jest.fn(async () => {}), writeFile: jest.fn(async () => { throw {}; }) }, cgroupRoot: '/test-cgroup' });
    await expect(unknownMemoryFailure.applyAction(valid.memoryLimit, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'Linux cgroup memory limit failed' });
    const noMemory = createLinuxAdapter({ ...h, fsImpl: { readFile: jest.fn(async () => 'cpu'), mkdir: jest.fn(), writeFile: jest.fn() }, cgroupRoot: '/test-cgroup' });
    await expect(noMemory.applyAction(valid.memoryLimit, { targetPid: 123 })).resolves.toMatchObject({ ok: true });
    expect(h.calls).toEqual(expect.arrayContaining([['prlimit', ['--pid', '123', '--as=1073741824:1073741824']]]));
    expect((await adapter.applyAction({ ...valid.memoryLimit, limit: 0 }, { targetPid: 123 })).ok).toBe(false);
    expect((await adapter.applyAction({ ...valid.memoryLimit, limit: 1 }, { targetPid: 123 })).ok).toBe(false);
    expect((await adapter.applyAction({ ...valid.memoryLimit, limit: 2 ** 41 }, { targetPid: 123 })).ok).toBe(false);
    expect((await adapter.applyAction(valid.memoryLimit, { targetPid: 0 })).ok).toBe(false);
    expect((await adapter.applyAction({ ...valid.affinity, value: 'balanced' }, { targetPid: 123 })).ok).toBe(true);
    expect((await adapter.applyAction(valid.cache, { approved: true })).ok).toBe(true);
    expect((await adapter.applyAction(valid.stop, { targetPid: 123, allowProcessStop: true, approvedBackgroundPids: new Set([123]) })).ok).toBe(true);
    expect((await adapter.applyAction(valid.io, { targetPid: 0 })).ok).toBe(false);
    for (const action of [valid.gpu, valid.memory]) expect((await adapter.applyAction(action)).ok).toBe(false);
    expect(h.calls).toEqual(expect.arrayContaining([
      ['powerprofilesctl', ['set', 'power-saver']],
      ['renice', ['-n', '10', '-p', '123']],
      ['ionice', ['-c', '2', '-n', '7', '-p', '123']],
      ['taskset', ['-p', expect.stringMatching(/^0x/), '123']],
      ['prlimit', ['--pid', '123', '--as=1073741824:1073741824']],
      ['kill', ['-TERM', '123']]
    ]));
    await expect(adapter.collectFacts()).resolves.toEqual(expect.objectContaining({ platform: 'linux' }));
  });

  test('returns command failures and unsupported platform refusal', async () => {
    const h = harness();
    h.commandRunner.run.mockResolvedValue({ code: 1, stderr: 'denied' });
    const adapter = createWindowsAdapter(h);
    await expect(adapter.applyAction(valid.power)).resolves.toEqual(expect.objectContaining({ ok: false, reason: 'denied' }));
    expect(() => createWindowsAdapter()).toThrow('command runner');
    expect(() => createWindowsAdapter({ commandRunner: h.commandRunner })).toThrow('cache cleaner');
    const linuxFailure = createLinuxAdapter(h);
    await expect(linuxFailure.applyAction(valid.power)).resolves.toEqual(expect.objectContaining({ ok: false, reason: 'denied' }));
    h.commandRunner.run.mockResolvedValue({ code: 1 });
    await expect(linuxFailure.applyAction(valid.power)).resolves.toEqual(expect.objectContaining({ ok: false, reason: 'set-power-profile failed' }));
    await expect(adapter.applyAction(valid.power)).resolves.toEqual(expect.objectContaining({ ok: false, reason: 'set-power-profile failed' }));
    expect(() => createLinuxAdapter()).toThrow('command runner');
    expect(() => createLinuxAdapter({ commandRunner: h.commandRunner })).toThrow('cache cleaner');
    expect((await linuxFailure.applyAction(valid.stop, { targetPid: 123, allowProcessStop: true })).ok).toBe(false);
    expect((await linuxFailure.applyAction(valid.stop, { targetPid: 123, allowProcessStop: true, approvedBackgroundPids: [123] })).ok).toBe(false);
    expect((await linuxFailure.applyAction(valid.priority, { targetPid: 0 })).ok).toBe(false);
    expect((await linuxFailure.applyAction(valid.affinity, { targetPid: 0 })).ok).toBe(false);
    await expect(linuxFailure.applyAction({ ...valid.affinity, value: 'unknown' }, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'unsupported process affinity value' });
    const fallbackAffinity = createLinuxAdapter({ ...h, cpuCount: 0 });
    await expect(fallbackAffinity.applyAction({ ...valid.affinity, value: 'balanced' }, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'set-process-affinity failed' });
    const wideAffinity = createLinuxAdapter({ ...h, cpuCount: 64 });
    await expect(wideAffinity.applyAction(valid.affinity, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'set-process-affinity failed' });
    expect((await adapter.applyAction(valid.affinity, { targetPid: 0 })).ok).toBe(false);
    await expect(adapter.applyAction({ ...valid.affinity, value: 'unknown' }, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'unsupported process affinity value' });
    expect((await linuxFailure.applyAction({ type: 'unknown' })).ok).toBe(false);
    const unsupported = createPlatformAdapter({ platform: 'freebsd', commandRunner: h.commandRunner, cacheCleaner: h.cacheCleaner });
    expect(unsupported.platform).toBe('freebsd');
    expect(unsupported.requiresAdmin).toBeUndefined();
    expect(unsupported.collectFacts()).toEqual(expect.objectContaining({ platform: 'freebsd' }));
    await expect(unsupported.applyAction(valid.power)).resolves.toEqual({ ok: false, reason: 'unsupported platform: freebsd' });
    expect(createPlatformAdapter({ platform: 'linux', commandRunner: h.commandRunner, cacheCleaner: h.cacheCleaner }).platform).toBe('linux');
    expect(createPlatformAdapter({ platform: 'win32', commandRunner: h.commandRunner, cacheCleaner: h.cacheCleaner }).platform).toBe('win32');
    expect(createPlatformAdapter({ platform: 'linux' }).platform).toBe('linux');
    expect(createPlatformAdapter().platform).toBe('linux');
  });

  test('macOS exposes only fixed priority/cache/process controls', async () => {
    const h = harness();
    const adapter = createMacosAdapter(h);
    expect(adapter.platform).toBe('darwin');
    expect(adapter.requiresAdmin(valid.stop)).toBe(true);
    expect(adapter.requiresAdmin({ ...valid.priority, value: 'high' })).toBe(true);
    expect(adapter.requiresAdmin({ ...valid.priority, value: 'low' })).toBe(false);
    expect((await adapter.applyAction(valid.priority, { targetPid: 123 })).ok).toBe(true);
    expect((await adapter.applyAction({ ...valid.priority, value: 'high' }, { targetPid: 123 })).ok).toBe(true);
    expect((await adapter.applyAction({ ...valid.priority, value: 'low' }, { targetPid: 123 })).ok).toBe(true);
    expect((await adapter.applyAction(valid.cache, { approved: true })).ok).toBe(true);
    expect((await adapter.applyAction(valid.stop, { targetPid: 123, allowProcessStop: true, approvedBackgroundPids: new Set([123]) })).ok).toBe(true);
    expect((await adapter.applyAction(valid.stop, { targetPid: 123, allowProcessStop: true, approvedBackgroundPids: [123] })).ok).toBe(true);
    expect((await adapter.applyAction(valid.stop, { targetPid: 123, allowProcessStop: true, approvedBackgroundPids: {} })).ok).toBe(false);
    expect((await adapter.applyAction(valid.stop, { targetPid: 123, allowProcessStop: false, approvedBackgroundPids: [123] })).ok).toBe(false);
    expect((await adapter.applyAction(valid.priority, { targetPid: 0 })).ok).toBe(false);
    for (const action of [valid.power, valid.io, valid.affinity, valid.cpuLimit, valid.memoryLimit, valid.gpu, valid.memory]) expect((await adapter.applyAction(action)).ok).toBe(false);
    expect((await adapter.applyAction({ type: 'unknown' })).ok).toBe(false);
    h.commandRunner.run.mockResolvedValue({ code: 1, stderr: 'denied' });
    await expect(adapter.applyAction({ ...valid.priority, value: 'low' }, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'denied' });
    h.commandRunner.run.mockResolvedValue({ code: 1 });
    await expect(adapter.applyAction({ ...valid.priority, value: 'low' }, { targetPid: 123 })).resolves.toMatchObject({ ok: false, reason: 'set-process-priority failed' });
    expect(h.calls).toEqual(expect.arrayContaining([
      ['renice', ['-n', '10', '-p', '123']],
      ['renice', ['-n', '-5', '-p', '123']],
      ['kill', ['-TERM', '123']]
    ]));
    await expect(adapter.collectFacts()).resolves.toEqual(expect.objectContaining({ platform: 'darwin' }));
    expect(() => createMacosAdapter()).toThrow('command runner');
    expect(() => createMacosAdapter({ commandRunner: h.commandRunner })).toThrow('cache cleaner');
    expect(createPlatformAdapter({ platform: 'darwin', commandRunner: h.commandRunner, cacheCleaner: h.cacheCleaner }).platform).toBe('darwin');
  });
});
