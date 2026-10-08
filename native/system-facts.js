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

function percentage(used, total) {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) return null;
  return Math.round((used / total) * 10000) / 100;
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
    gpu: { available: false, vendor: null, utilizationPercent: null, memoryUsedBytes: null, memoryTotalBytes: null, temperatureC: null },
    collectedAt: new Date().toISOString()
  };
}

function parseNvidiaLine(output) {
  const parts = String(output || '').trim().split(',').map((part) => Number(part.trim()));
  if (parts.length < 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [utilizationPercent, memoryTotalMiB, memoryUsedMiB, temperatureC] = parts;
  return {
    available: true,
    vendor: 'nvidia',
    utilizationPercent,
    memoryUsedBytes: memoryUsedMiB * 1024 ** 2,
    memoryTotalBytes: memoryTotalMiB * 1024 ** 2,
    temperatureC
  };
}

/** Read optional NVIDIA telemetry without making GPU support a requirement. */
export async function collectGpuFacts({ platform, commandRunner } = {}) {
  if (!commandRunner || (platform !== 'win32' && platform !== 'linux')) {
    return { available: false, vendor: null, utilizationPercent: null, memoryUsedBytes: null, memoryTotalBytes: null, temperatureC: null };
  }
  try {
    const result = await commandRunner.run('nvidia-smi', [
      '--query-gpu=utilization.gpu,memory.total,memory.used,temperature.gpu',
      '--format=csv,noheader,nounits'
    ], { timeoutMs: 2500, maxOutputBytes: 2048 });
    return result.code === 0 ? (parseNvidiaLine(result.stdout) || { available: false, vendor: null }) : { available: false, vendor: null };
  } catch {
    return { available: false, vendor: null };
  }
}

export async function collectSystemFacts({ platform = process.platform, osImpl = os, commandRunner } = {}) {
  const facts = collectBaseFacts({ platform, osImpl });
  facts.gpu = await collectGpuFacts({ platform, commandRunner });
  const storage = await collectStoragePressureSnapshot({ platform, commandRunner });
  const telemetry = await collectWorkstationTelemetry({ platform, commandRunner });
  facts.storage = storage.storage;
  facts.pagefile = storage.pagefile;
  facts.storagePressure = storage.pressure;
  facts.storagePressureAvailable = storage.available;
  facts.processes = telemetry.processes.processes;
  facts.battery = telemetry.battery;
  facts.thermals = telemetry.thermals;
  facts.network = telemetry.network;
  facts.telemetry = telemetry;
  return facts;
}
