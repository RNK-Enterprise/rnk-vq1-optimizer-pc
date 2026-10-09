/**
 * Native Linux I/O budget tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { applyLinuxIoBudget, MAX_LINUX_IO_BYTES_PER_SECOND, validLinuxBlockDevice } from '../native/linux-io-budget.js';

describe('native Linux I/O budget authority', () => {
  test('validates bounded block-device evidence', async () => {
    expect(validLinuxBlockDevice('8:0')).toBe(true);
    expect(validLinuxBlockDevice('0:0')).toBe(false);
    expect(validLinuxBlockDevice('bad')).toBe(false);
    expect(await applyLinuxIoBudget()).toEqual({ ok: false, reason: 'target process id is unavailable' });
    expect(await applyLinuxIoBudget(12, 0, '8:0')).toEqual({ ok: false, reason: 'Linux I/O byte-rate limit is invalid' });
    expect(await applyLinuxIoBudget(12, MAX_LINUX_IO_BYTES_PER_SECOND + 1, '8:0')).toEqual({ ok: false, reason: 'Linux I/O byte-rate limit is invalid' });
    expect(await applyLinuxIoBudget(12, 1024, 'device')).toEqual({ ok: false, reason: 'Linux I/O budget requires a block-device major:minor pair' });
  });

  test('requires the cgroup controller and writes a bounded io.max rule', async () => {
    const fsImpl = {
      readFile: jest.fn(async () => 'cpu memory io'),
      mkdir: jest.fn(async () => {}),
      writeFile: jest.fn(async () => {})
    };
    await expect(applyLinuxIoBudget(123, 4096, '8:0', { fsImpl, cgroupRoot: '/test-cgroup' })).resolves.toEqual(expect.objectContaining({ ok: true, mechanism: 'cgroup-v2-io.max', group: '/test-cgroup/rnk-optimizer-123', device: '8:0', limit: 4096 }));
    expect(fsImpl.writeFile).toHaveBeenCalledWith('/test-cgroup/rnk-optimizer-123/io.max', '8:0 rbps=4096 wbps=4096');
    expect(fsImpl.writeFile).toHaveBeenCalledWith('/test-cgroup/rnk-optimizer-123/cgroup.procs', '123');
    await expect(applyLinuxIoBudget(123, 4096, '8:0', { fsImpl: { readFile: jest.fn(async () => 'cpu memory'), mkdir: jest.fn(), writeFile: jest.fn() } })).resolves.toEqual({ ok: false, reason: 'Linux cgroup I/O controller is unavailable' });
    await expect(applyLinuxIoBudget(123, 4096, '8:0', { fsImpl: { readFile: jest.fn(async () => { throw new Error('read denied'); }), mkdir: jest.fn(), writeFile: jest.fn() } })).resolves.toEqual({ ok: false, reason: 'read denied' });
    await expect(applyLinuxIoBudget(123, 4096, '8:0', { fsImpl: { readFile: jest.fn(async () => { throw {}; }), mkdir: jest.fn(), writeFile: jest.fn() } })).resolves.toEqual({ ok: false, reason: 'Linux cgroup I/O controller is unavailable' });
  });

  test('reports cgroup write failures without claiming enforcement', async () => {
    const failure = await applyLinuxIoBudget(123, 4096, '8:0', { fsImpl: { readFile: jest.fn(async () => 'io'), mkdir: jest.fn(async () => {}), writeFile: jest.fn(async () => { throw new Error('write denied'); }) } });
    expect(failure).toEqual({ ok: false, reason: 'write denied' });
    const unknown = await applyLinuxIoBudget(123, 4096, '8:0', { fsImpl: { readFile: jest.fn(async () => 'io'), mkdir: jest.fn(async () => {}), writeFile: jest.fn(async () => { throw {}; }) } });
    expect(unknown).toEqual({ ok: false, reason: 'Linux cgroup I/O limit failed' });
  });
});
