/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Windows per-process network authority. Counters come from the shipped
 * IPv4 TCP EStats provider; shaping uses the inbox NetQos application policy.
 */

import { MAX_NETWORK_BYTES_PER_SECOND, MIN_NETWORK_BYTES_PER_SECOND } from './protocol.js';
import { fileURLToPath } from 'url';

export const WINDOWS_NETWORK_VERSION = 1;
const PROVIDER = 'windows-network-counters.ps1';
const PROVIDER_PATH = fileURLToPath(new URL('./windows-network-counters.ps1', import.meta.url));
const SHAPE_SCRIPT = '$ErrorActionPreference="Stop"; $pidValue=[int]$args[0]; $rate=[UInt64]$args[1]; $p=Get-Process -Id $pidValue; if ([string]::IsNullOrWhiteSpace($p.Path)) { throw "process path unavailable" }; $name="RNK-Optimizer-$pidValue"; Get-NetQosPolicy -Name $name -ErrorAction SilentlyContinue | Remove-NetQosPolicy -Confirm:$false; New-NetQosPolicy -Name $name -AppPathNameMatchCondition $p.Path -ThrottleRateActionBitsPerSecond ($rate * 8) -PolicyStore ActiveStore | Out-Null';
const REMOVE_SCRIPT = '$ErrorActionPreference="Stop"; $name="RNK-Optimizer-" + [int]$args[0]; Get-NetQosPolicy -Name $name -ErrorAction SilentlyContinue | Remove-NetQosPolicy -Confirm:$false';

function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function pid(value) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 && parsed <= 2147483647 ? parsed : null; }
function rate(value) { const parsed = number(value); return Number.isInteger(parsed) && parsed >= MIN_NETWORK_BYTES_PER_SECOND && parsed <= MAX_NETWORK_BYTES_PER_SECOND ? parsed : null; }
function unavailable(reason) { return Object.freeze({ version: WINDOWS_NETWORK_VERSION, state: 'unavailable', available: false, platform: 'win32', processes: Object.freeze([]), source: 'windows-ipv4-tcp-estats', reason }); }
function rows(value) { return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []; }

export function parseWindowsNetworkCounters(output) {
  let parsed;
  try { parsed = JSON.parse(String(output || '')); } catch { return unavailable('Windows network counter provider returned invalid JSON'); }
  const processes = rows(parsed).map((item) => {
    const processId = pid(item?.Pid ?? item?.ProcessId);
    const receivedBytes = number(item?.BytesReceived ?? item?.ReceivedBytes);
    const sentBytes = number(item?.BytesSent ?? item?.SentBytes);
    if (!processId || receivedBytes === null || sentBytes === null) return null;
    return Object.freeze({ pid: processId, name: typeof item?.ProcessName === 'string' && item.ProcessName.trim() ? item.ProcessName.trim() : 'unknown', receivedBytes, sentBytes, platform: 'win32', source: 'windows-ipv4-tcp-estats' });
  }).filter(Boolean).slice(0, 512);
  return Object.freeze({ version: WINDOWS_NETWORK_VERSION, state: processes.length ? 'observed' : 'unavailable', available: processes.length > 0, platform: 'win32', processes: Object.freeze(processes), source: 'windows-ipv4-tcp-estats', reason: processes.length ? null : 'no valid process counters were returned' });
}

export async function collectWindowsNetworkCounters({ commandRunner } = {}) {
  if (!commandRunner || typeof commandRunner.run !== 'function') return unavailable('command runner unavailable');
  try {
    const result = await commandRunner.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PROVIDER_PATH, '--json'], { timeoutMs: 10000, maxOutputBytes: 65536 });
    return result?.code === 0 ? parseWindowsNetworkCounters(result.stdout) : unavailable(result?.stderr || 'Windows network counter provider failed');
  } catch (error) { return unavailable(error.message); }
}

export function buildWindowsTrafficShapeAction({ pid: processId, bytesPerSecond } = {}) {
  const target = pid(processId);
  const limit = rate(bytesPerSecond);
  if (!target || limit === null) throw new Error('Windows traffic shaping requires a bounded process id and byte rate');
  return Object.freeze({ type: 'set-process-network-limit', key: 'process.network-limit', value: 'bytes-per-second', limit, pid: target, requiresApproval: true, requiresAdmin: true });
}

export async function applyWindowsTrafficShape(action, { commandRunner, approved = false, dryRun = true } = {}) {
  const plan = buildWindowsTrafficShapeAction({ pid: action?.pid, bytesPerSecond: action?.limit });
  if (!approved) return Object.freeze({ state: 'approval-required', applied: false, action: plan });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, action: plan });
  if (!commandRunner || typeof commandRunner.run !== 'function') return Object.freeze({ state: 'unavailable', applied: false, action: plan, reason: 'command runner unavailable' });
  try {
    const result = await commandRunner.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SHAPE_SCRIPT, '--', String(plan.pid), String(plan.limit)], { timeoutMs: 10000, maxOutputBytes: 8192 });
    return Object.freeze(result?.code === 0 ? { state: 'applied', applied: true, action: plan } : { state: 'rejected', applied: false, action: plan, reason: result?.stderr || 'Windows traffic shaping failed' });
  } catch (error) { return Object.freeze({ state: 'rejected', applied: false, action: plan, reason: error.message }); }
}

export async function removeWindowsTrafficShape(processId, { commandRunner, approved = false, dryRun = true } = {}) {
  const target = pid(processId);
  if (!target) throw new Error('Windows traffic shaping removal requires a valid process id');
  if (!approved) return Object.freeze({ state: 'approval-required', removed: false, pid: target });
  if (dryRun) return Object.freeze({ state: 'preview', removed: false, pid: target });
  if (!commandRunner || typeof commandRunner.run !== 'function') return Object.freeze({ state: 'unavailable', removed: false, pid: target, reason: 'command runner unavailable' });
  try {
    const result = await commandRunner.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', REMOVE_SCRIPT, '--', String(target)], { timeoutMs: 10000, maxOutputBytes: 8192 });
    return Object.freeze(result?.code === 0 ? { state: 'removed', removed: true, pid: target } : { state: 'rejected', removed: false, pid: target, reason: result?.stderr || 'Windows traffic shaping removal failed' });
  } catch (error) { return Object.freeze({ state: 'rejected', removed: false, pid: target, reason: error.message }); }
}

export function windowsTrafficShapeCommands() { return Object.freeze({ provider: PROVIDER, providerPath: PROVIDER_PATH, apply: SHAPE_SCRIPT, remove: REMOVE_SCRIPT }); }
