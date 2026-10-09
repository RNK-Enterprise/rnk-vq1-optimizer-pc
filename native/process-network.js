/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Optional native per-process network-rate evidence. Linux NetHogs is used
 * only in bounded trace mode; missing capability or tooling remains explicit
 * unavailability. This module never shapes traffic or stops a process.
 */

export const PROCESS_NETWORK_VERSION = 1;
const MAX_PROCESSES = 512;
const EMPTY = Object.freeze([]);

function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function pid(value) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
function unavailable(platform, source) { return Object.freeze({ version: PROCESS_NETWORK_VERSION, available: false, platform, processes: EMPTY, truncated: false, source }); }

function traceIdentity(value) {
  const parts = String(value).trim().split('/');
  const index = parts.findIndex((part, offset) => /^\d+$/.test(part) && /^\d+$/.test(parts[offset + 1]));
  if (index < 1) return null;
  const name = parts.slice(0, index).join('/');
  return { name: name || 'unknown', pid: pid(parts[index]) };
}

function parseTraceLine(line) {
  const raw = String(line).trim();
  if (!raw || /^(?:refreshing|pid\s+user|total\s)/i.test(raw)) return null;
  const tabFields = raw.split(/\t+/).map((field) => field.trim()).filter(Boolean);
  if (tabFields.length >= 3) {
    const identity = traceIdentity(tabFields[0]);
    const sent = number(tabFields[1]);
    const received = number(tabFields[2]);
    if (identity?.pid && sent !== null && received !== null) return { ...identity, sentBytesPerSecond: sent * 1024, receivedBytesPerSecond: received * 1024 };
  }
  const fields = raw.split(/\s+/);
  const processId = pid(fields[0]);
  const sent = number(fields.at(-2));
  const received = number(fields.at(-1));
  if (!processId || sent === null || received === null || fields.length < 5) return null;
  return { pid: processId, name: fields.slice(2, -3).join(' ') || 'unknown', sentBytesPerSecond: sent * 1024, receivedBytesPerSecond: received * 1024 };
}

export function parseProcessNetworkTelemetry(output, { platform = 'linux' } = {}) {
  const lines = String(output || '').split(/\r?\n/).filter((line) => line.trim());
  const processes = lines.map(parseTraceLine).filter(Boolean).map((item) => Object.freeze({ ...item, platform, source: 'nethogs', units: 'bytes-per-second' }));
  return Object.freeze({ version: PROCESS_NETWORK_VERSION, available: processes.length > 0, platform, processes: Object.freeze(processes.slice(0, MAX_PROCESSES)), truncated: processes.length > MAX_PROCESSES, source: 'nethogs' });
}

export async function collectProcessNetworkTelemetry({ platform = process.platform, commandRunner } = {}) {
  if (platform !== 'linux') return unavailable(platform, 'platform per-process network counters unavailable');
  if (!commandRunner || typeof commandRunner.run !== 'function') return unavailable(platform, 'command runner unavailable');
  try {
    const result = await commandRunner.run('nethogs', ['-t', '-c', '1', '-d', '1', '-v', '0'], { timeoutMs: 5000, maxOutputBytes: 65536 });
    if (result?.code !== 0) return unavailable(platform, result?.stderr || 'nethogs command failed');
    return parseProcessNetworkTelemetry(result.stdout, { platform });
  } catch (error) {
    return unavailable(platform, error.message);
  }
}
