/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/gpl-3.0.html>.
 *
 * Facts are observations only. They do not grant the server authority to
 * execute a command or disclose file contents.
 */

import os from 'os';
import { collectStoragePressureSnapshot } from './storage-pressure.js';
import { collectWorkstationTelemetry } from './workstation-telemetry.js';
import { collectDriveHealth } from './drive-health.js';
import { collectVolumeStorage } from './volume-storage.js';

function percentage(used, total) {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) return null;
  return Math.round((used / total) * 10000) / 100;
}

function unavailableGpu() {
  return { available: false, vendor: null, utilizationPercent: null, memoryUsedBytes: null, memoryTotalBytes: null, temperatureC: null, thermalThrottling: null, powerLimitWatts: null, powerMinLimitWatts: null, powerMaxLimitWatts: null };
}

function unavailableGpuProcesses(platform = 'unknown', reason = 'unavailable') {
  return Object.freeze({ available: false, platform, processes: Object.freeze([]), source: reason });
}

export function collectBaseFacts({ platform = process.platform, osImpl = os } = {}) {
  const cpus = typeof osImpl.cpus === 'function' ? osImpl.cpus() : [];
  const totalMemory = typeof osImpl.totalmem === 'function' ? osImpl.totalmem() : null;
  const freeMemory = typeof osImpl.freemem === 'function' ? osImpl.freemem() : null;
  const load = typeof osImpl.loadavg === 'function' ? osImpl.loadavg() : [];
  return {
    platform,
    cpu: {
      cores: cpus.length || null,
      model: cpus[0]?.model || null,
      load1: Number.isFinite(load[0]) ? load[0] : null,
      load5: Number.isFinite(load[1]) ? load[1] : null,
      load15: Number.isFinite(load[2]) ? load[2] : null
    },
    memory: {
      totalBytes: totalMemory,
      freeBytes: freeMemory,
      usedPercent: totalMemory !== null && freeMemory !== null
        ? percentage(totalMemory - freeMemory, totalMemory)
        : null
    },
    gpu: unavailableGpu(),
    collectedAt: new Date().toISOString()
  };
}

function parseNvidiaLine(output) {
  const parts = String(output || '').trim().split(',').map((part) => Number(part.trim()));
  if (parts.length < 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [utilizationPercent, memoryTotalMiB, memoryUsedMiB, temperatureC, hardwareThermal, softwareThermal, powerLimitWatts, powerMinLimitWatts, powerMaxLimitWatts] = parts;
  const thermalFlags = parts.slice(4, 6);
  return {
    available: true,
    vendor: 'nvidia',
    utilizationPercent,
    memoryUsedBytes: memoryUsedMiB * 1024 ** 2,
    memoryTotalBytes: memoryTotalMiB * 1024 ** 2,
    temperatureC,
    thermalThrottling: thermalFlags.length >= 2 ? hardwareThermal !== 0 || softwareThermal !== 0 : null,
    powerLimitWatts: Number.isFinite(powerLimitWatts) && powerLimitWatts > 0 ? powerLimitWatts : null,
    powerMinLimitWatts: Number.isFinite(powerMinLimitWatts) && powerMinLimitWatts > 0 ? powerMinLimitWatts : null,
    powerMaxLimitWatts: Number.isFinite(powerMaxLimitWatts) && powerMaxLimitWatts > 0 ? powerMaxLimitWatts : null
  };
}

/** Read optional NVIDIA telemetry without making GPU support a requirement. */
export async function collectGpuFacts({ platform, commandRunner } = {}) {
  if (!commandRunner || (platform !== 'win32' && platform !== 'linux')) {
    return unavailableGpu();
  }
  try {
    const result = await commandRunner.run('nvidia-smi', [
      '--query-gpu=utilization.gpu,memory.total,memory.used,temperature.gpu,clocks_throttle_reasons.hw_thermal_slowdown,clocks_throttle_reasons.sw_thermal_slowdown,power.limit,power.min_limit,power.max_limit',
      '--format=csv,noheader,nounits'
    ], { timeoutMs: 2500, maxOutputBytes: 2048 });
    return result.code === 0 ? (parseNvidiaLine(result.stdout) || unavailableGpu()) : unavailableGpu();
  } catch {
    return unavailableGpu();
  }
}

export function parseNvidiaProcessFacts(output, { platform = 'unknown' } = {}) {
  const processes = String(output || '').split(/\r?\n/).map((line) => {
    const [pidValue, memoryValue] = line.split(',').map((part) => part.trim());
    const pid = Number(pidValue);
    const memoryMiB = Number(memoryValue);
    return Number.isInteger(pid) && pid > 0 && Number.isFinite(memoryMiB) && memoryMiB >= 0
      ? Object.freeze({ pid, memoryBytes: memoryMiB * 1024 ** 2 })
      : null;
  }).filter(Boolean).slice(0, 512);
  return Object.freeze({ available: processes.length > 0, platform, processes: Object.freeze(processes), source: 'nvidia-smi-compute-apps' });
}

export async function collectGpuProcessFacts({ platform, commandRunner } = {}) {
  if (!commandRunner || (platform !== 'win32' && platform !== 'linux')) return unavailableGpuProcesses(platform);
  try {
    const result = await commandRunner.run('nvidia-smi', [
      '--query-compute-apps=pid,used_gpu_memory',
      '--format=csv,noheader,nounits'
    ], { timeoutMs: 2500, maxOutputBytes: 16384 });
    return result.code === 0
      ? parseNvidiaProcessFacts(result.stdout, { platform })
      : unavailableGpuProcesses(platform, result.stderr || 'nvidia process query failed');
  } catch (error) {
    return unavailableGpuProcesses(platform, error.message);
  }
}

export function attachGpuProcessFacts(processes, gpuFacts) {
  const gpuByPid = new Map((Array.isArray(gpuFacts?.processes) ? gpuFacts.processes : []).map((item) => [item.pid, item.memoryBytes]));
  return Object.freeze((Array.isArray(processes) ? processes : []).map((item) => Object.freeze({ ...item, gpuMemoryBytes: gpuByPid.get(item.pid) ?? null })));
}

export async function collectSystemFacts({ platform = process.platform, osImpl = os, commandRunner } = {}) {
  const facts = collectBaseFacts({ platform, osImpl });
  facts.gpu = await collectGpuFacts({ platform, commandRunner });
  facts.gpuProcesses = await collectGpuProcessFacts({ platform, commandRunner });
  const storage = await collectStoragePressureSnapshot({ platform, commandRunner });
  const telemetry = await collectWorkstationTelemetry({ platform, commandRunner });
  const drives = await collectDriveHealth({ platform, commandRunner });
  const volumes = await collectVolumeStorage({ platform, commandRunner });
  facts.storage = storage.storage;
  facts.pagefile = storage.pagefile;
  facts.storagePressure = storage.pressure;
  facts.storagePressureAvailable = storage.available;
  facts.processes = attachGpuProcessFacts(telemetry.processes.processes, facts.gpuProcesses);
  facts.battery = telemetry.battery;
  facts.thermals = telemetry.thermals;
  facts.fans = telemetry.fans;
  facts.network = telemetry.network;
  facts.networkConnections = telemetry.networkConnections;
  facts.networkProcesses = telemetry.networkProcesses;
  facts.startup = telemetry.startup;
  facts.telemetry = telemetry;
  facts.drives = drives;
  facts.volumes = volumes;
  return facts;
}
