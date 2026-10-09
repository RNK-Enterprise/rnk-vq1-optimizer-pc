/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Linux cgroup-v2 I/O byte-rate authority. The caller must provide an
 * observed block-device major:minor pair; no device path is accepted.
 */

import fs from 'fs/promises';
import path from 'path';

export const LINUX_IO_BUDGET_VERSION = 1;
export const MAX_LINUX_IO_BYTES_PER_SECOND = 10 * 1024 ** 3;

function validPid(value) { return Number.isInteger(value) && value > 0 && value <= 2147483647; }
function validLimit(value) { return Number.isInteger(value) && value > 0 && value <= MAX_LINUX_IO_BYTES_PER_SECOND; }
export function validLinuxBlockDevice(value) { return typeof value === 'string' && /^[1-9]\d*:\d+$/u.test(value); }

export async function applyLinuxIoBudget(pid, limit, device, { fsImpl = fs, pathImpl = path, cgroupRoot = '/sys/fs/cgroup' } = {}) {
  if (!validPid(pid)) return { ok: false, reason: 'target process id is unavailable' };
  if (!validLimit(limit)) return { ok: false, reason: 'Linux I/O byte-rate limit is invalid' };
  if (!validLinuxBlockDevice(device)) return { ok: false, reason: 'Linux I/O budget requires a block-device major:minor pair' };
  let controllers;
  try {
    controllers = String(await fsImpl.readFile(pathImpl.join(cgroupRoot, 'cgroup.controllers'))).split(/\s+/u).filter(Boolean);
  } catch (error) {
    return { ok: false, reason: error?.message || 'Linux cgroup I/O controller is unavailable' };
  }
  if (!controllers.includes('io')) return { ok: false, reason: 'Linux cgroup I/O controller is unavailable' };
  const group = pathImpl.join(cgroupRoot, `rnk-optimizer-${pid}`);
  try {
    await fsImpl.mkdir(group, { recursive: true });
    await fsImpl.writeFile(pathImpl.join(group, 'io.max'), `${device} rbps=${limit} wbps=${limit}`);
    await fsImpl.writeFile(pathImpl.join(group, 'cgroup.procs'), String(pid));
    return { ok: true, operation: 'set-process-resource-limit', mechanism: 'cgroup-v2-io.max', group, device, limit };
  } catch (error) {
    return { ok: false, reason: error?.message || 'Linux cgroup I/O limit failed' };
  }
}
