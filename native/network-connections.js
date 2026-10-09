/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Fixed read-only network-connection evidence. Connection ownership is useful
 * context for workload review, but it is not bandwidth measurement or control.
 */

export const NETWORK_CONNECTIONS_VERSION = 1;
const EMPTY = Object.freeze([]);
const MAX_CONNECTIONS = 512;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function number(value) { const parsed = typeof value === 'string' && value.trim() ? Number(value) : value; return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
function rows(value) { return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []; }
function json(output) { try { return JSON.parse(String(output || '')); } catch { return null; } }

function endpoint(value) {
  const raw = text(value);
  if (!raw) return { address: null, port: null };
  const separator = raw.lastIndexOf(':');
  if (separator <= 0) return { address: raw, port: null };
  return { address: raw.slice(0, separator).replace(/^\[|\]$/g, ''), port: text(raw.slice(separator + 1)) };
}

function endpointFor(row, endpointKey, directKey, addressKey, portValue) {
  if (row?.[endpointKey]) return row[endpointKey];
  if (row?.[directKey]) return row[directKey];
  if (row?.[addressKey]) return `${row[addressKey]}:${portValue ?? ''}`;
  return null;
}

function normalizeConnection(row, platform) {
  const pid = number(row?.pid ?? row?.OwningProcess ?? row?.processId);
  if (pid === null) return null;
  const local = endpoint(endpointFor(row, 'localEndpoint', 'local', 'LocalAddress', row?.localPort ?? row?.LocalPort));
  const remote = endpoint(endpointFor(row, 'remoteEndpoint', 'remote', 'RemoteAddress', row?.remotePort ?? row?.RemotePort));
  return Object.freeze({
    pid,
    name: text(row?.name ?? row?.ProcessName) || 'unknown',
    protocol: (text(row?.protocol ?? row?.Protocol) || 'tcp').toLowerCase(),
    state: text(row?.state ?? row?.State) || 'unknown',
    localAddress: local.address,
    localPort: local.port,
    remoteAddress: remote.address,
    remotePort: remote.port,
    platform
  });
}

function parseSsLine(line, platform) {
  const fields = String(line).trim().split(/\s+/);
  if (fields.length < 6) return null;
  const pid = String(line).match(/pid=(\d+)/)?.[1];
  const name = String(line).match(/\(\("([^"]+)/)?.[1];
  return normalizeConnection({ pid, name, protocol: fields[0], state: fields[1], localEndpoint: fields[4], remoteEndpoint: fields[5] }, platform);
}

function parseLsofLine(line, platform) {
  const match = String(line).match(/^(\S+)\s+(\d+)\s+.*?\s(TCP|UDP)\s+(\S+?)(?:->(\S+?))?\s+\(([^)]+)\)/i);
  if (!match) return null;
  return normalizeConnection({ pid: match[2], name: match[1], protocol: match[3], localEndpoint: match[4], remoteEndpoint: match[5], state: match[6] }, platform);
}

export function parseNetworkConnectionTelemetry(output, { platform = 'unknown' } = {}) {
  let connections;
  let truncated = false;
  if (platform === 'win32') {
    const parsed = rows(json(output));
    connections = parsed.map((row) => normalizeConnection(row, platform)).filter(Boolean);
    truncated = parsed.length > MAX_CONNECTIONS;
  } else if (platform === 'linux') {
    const lines = String(output || '').split(/\r?\n/).filter((line) => line.trim());
    connections = lines.map((line) => parseSsLine(line, platform)).filter(Boolean);
    truncated = lines.length > MAX_CONNECTIONS;
  } else if (platform === 'darwin') {
    const lines = String(output || '').split(/\r?\n/).filter((line) => line.trim() && !/^COMMAND\s+PID\s+/i.test(line));
    connections = lines.map((line) => parseLsofLine(line, platform)).filter(Boolean);
    truncated = lines.length > MAX_CONNECTIONS;
  } else {
    return Object.freeze({ available: false, connections: EMPTY, truncated: false, platform, source: 'platform unsupported' });
  }
  return Object.freeze({ version: NETWORK_CONNECTIONS_VERSION, available: connections.length > 0, connections: Object.freeze(connections.slice(0, MAX_CONNECTIONS)), truncated, platform, source: platform === 'win32' ? 'Get-NetTCPConnection' : platform === 'linux' ? 'ss' : 'lsof' });
}

export async function collectNetworkConnectionTelemetry({ platform = process.platform, commandRunner } = {}) {
  if (!commandRunner || typeof commandRunner.run !== 'function') return Object.freeze({ version: NETWORK_CONNECTIONS_VERSION, available: false, connections: EMPTY, truncated: false, platform, source: 'command runner unavailable' });
  const command = platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Get-NetTCPConnection | Select-Object OwningProcess,State,LocalAddress,LocalPort,RemoteAddress,RemotePort | ConvertTo-Json -Compress'], { timeoutMs: 5000, maxOutputBytes: 65536 }]
    : platform === 'linux'
      ? ['ss', ['-tunpH'], { timeoutMs: 2500, maxOutputBytes: 65536 }]
      : platform === 'darwin'
        ? ['lsof', ['-nP', '-i'], { timeoutMs: 2500, maxOutputBytes: 65536 }]
        : null;
  if (!command) return Object.freeze({ version: NETWORK_CONNECTIONS_VERSION, available: false, connections: EMPTY, truncated: false, platform, source: 'platform unsupported' });
  try {
    const result = await commandRunner.run(command[0], command[1], command[2]);
    if (result?.code !== 0) return Object.freeze({ version: NETWORK_CONNECTIONS_VERSION, available: false, connections: EMPTY, truncated: false, platform, source: result?.stderr || 'network connection command failed' });
    return parseNetworkConnectionTelemetry(result.stdout, { platform });
  } catch (error) {
    return Object.freeze({ version: NETWORK_CONNECTIONS_VERSION, available: false, connections: EMPTY, truncated: false, platform, source: error.message });
  }
}
