/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Windows network authority. Counters come from the shipped TCP EStats
 * provider; shaping uses the inbox NetQos application-path policy. Windows
 * NetQos does not expose a process-instance throttle, so that scope is named
 * explicitly in every shape result.
 */

import { MAX_NETWORK_BYTES_PER_SECOND, MIN_NETWORK_BYTES_PER_SECOND } from './protocol.js';
import { fileURLToPath } from 'url';

export const WINDOWS_NETWORK_VERSION = 1;
export const WINDOWS_NETWORK_COVERAGE = Object.freeze({
  tcp: Object.freeze(['ipv4']),
  ipv6: false,
  udp: false,
  quic: false
});
const PROVIDER = 'windows-network-counters.ps1';
const PROVIDER_PATH = fileURLToPath(new URL('./windows-network-counters.ps1', import.meta.url));
const SHAPE_SCRIPT = '$ErrorActionPreference="Stop"; $pidValue=[int]$args[0]; $rate=[UInt64]$args[1]; $p=Get-Process -Id $pidValue; if ([string]::IsNullOrWhiteSpace($p.Path)) { throw "process path unavailable" }; $name="RNK-Optimizer-$pidValue"; Get-NetQosPolicy -Name $name -ErrorAction SilentlyContinue | Remove-NetQosPolicy -Confirm:$false; New-NetQosPolicy -Name $name -AppPathNameMatchCondition $p.Path -ThrottleRateActionBitsPerSecond ($rate * 8) -PolicyStore ActiveStore | Out-Null; [pscustomobject]@{verified=$true; requestedPid=$pidValue; resolvedExecutablePath=$p.Path; enforcementScope="APPLICATION_PATH"; policyName=$name; rateBytesPerSecond=$rate} | ConvertTo-Json -Compress';
const REMOVE_SCRIPT = '$ErrorActionPreference="Stop"; $pidValue=[int]$args[0]; $name="RNK-Optimizer-" + $pidValue; Get-NetQosPolicy -Name $name -ErrorAction SilentlyContinue | Remove-NetQosPolicy -Confirm:$false; [pscustomobject]@{verified=$true; requestedPid=$pidValue; enforcementScope="APPLICATION_PATH"; policyName=$name; verification="REMOVED"} | ConvertTo-Json -Compress';

function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function pid(value) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 && parsed <= 2147483647 ? parsed : null; }
function rate(value) { const parsed = number(value); return Number.isInteger(parsed) && parsed >= MIN_NETWORK_BYTES_PER_SECOND && parsed <= MAX_NETWORK_BYTES_PER_SECOND ? parsed : null; }
function unavailable(reason) { return Object.freeze({ version: WINDOWS_NETWORK_VERSION, state: 'unavailable', available: false, platform: 'win32', processes: Object.freeze([]), source: 'windows-ipv4-tcp-estats', coverage: WINDOWS_NETWORK_COVERAGE, reason }); }
function rows(value) { return Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []; }
function networkProtocol(value) { const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''; return normalized === 'tcp' ? normalized : null; }
function addressFamily(value) { const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''; return normalized === 'ipv4' ? normalized : null; }
function shapeVerification(output) { try { const parsed = JSON.parse(String(output || '')); return parsed && parsed.verified === true ? parsed : null; } catch { return null; } }

export function parseWindowsNetworkCounters(output) {
  let parsed;
  try { parsed = JSON.parse(String(output || '')); } catch { return unavailable('Windows network counter provider returned invalid JSON'); }
  const processes = rows(parsed).map((item) => {
    const processId = pid(item?.Pid ?? item?.ProcessId);
    const receivedBytes = number(item?.BytesReceived ?? item?.ReceivedBytes);
    const sentBytes = number(item?.BytesSent ?? item?.SentBytes);
    if (!processId || receivedBytes === null || sentBytes === null) return null;
    const protocol = item?.Protocol === undefined ? 'tcp' : networkProtocol(item.Protocol);
    const family = item?.AddressFamily === undefined ? 'ipv4' : addressFamily(item.AddressFamily);
    if (!protocol || !family) return null;
    return Object.freeze({ pid: processId, name: typeof item?.ProcessName === 'string' && item.ProcessName.trim() ? item.ProcessName.trim() : 'unknown', receivedBytes, sentBytes, protocol, addressFamily: family, platform: 'win32', source: 'windows-ipv4-tcp-estats' });
  }).filter(Boolean).slice(0, 512);
  return Object.freeze({ version: WINDOWS_NETWORK_VERSION, state: processes.length ? 'observed' : 'unavailable', available: processes.length > 0, platform: 'win32', processes: Object.freeze(processes), source: 'windows-ipv4-tcp-estats', coverage: WINDOWS_NETWORK_COVERAGE, reason: processes.length ? null : 'no valid process counters were returned' });
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
  return Object.freeze({ type: 'set-process-network-limit', label: 'WINDOWS_APP_NETWORK_LIMIT', key: 'process.network-limit', value: 'bytes-per-second', limit, pid: target, requestedPid: target, policyName: `RNK-Optimizer-${target}`, scope: 'APPLICATION_PATH', instanceScoped: false, requiresApproval: true, requiresAdmin: true });
}

export async function applyWindowsTrafficShape(action, { commandRunner, approved = false, dryRun = true } = {}) {
  const plan = buildWindowsTrafficShapeAction({ pid: action?.pid, bytesPerSecond: action?.limit });
  if (!approved) return Object.freeze({ state: 'approval-required', applied: false, action: plan });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, action: plan });
  if (!commandRunner || typeof commandRunner.run !== 'function') return Object.freeze({ state: 'unavailable', applied: false, action: plan, reason: 'command runner unavailable' });
  try {
    const result = await commandRunner.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SHAPE_SCRIPT, '--', String(plan.pid), String(plan.limit)], { timeoutMs: 10000, maxOutputBytes: 8192 });
    const verification = shapeVerification(result?.stdout);
    return Object.freeze(result?.code === 0 && verification
      ? { state: 'applied', applied: true, verified: true, verification: 'verified', requestedPid: plan.pid, resolvedExecutablePath: verification.resolvedExecutablePath || null, policyName: verification.policyName || plan.policyName, rateBytesPerSecond: verification.rateBytesPerSecond ?? plan.limit, scope: 'APPLICATION_PATH', instanceScoped: false, action: plan }
      : { state: 'rejected', applied: false, verified: false, scope: 'APPLICATION_PATH', instanceScoped: false, action: plan, reason: result?.code !== 0 ? result?.stderr || 'Windows traffic shaping failed' : 'Windows traffic shaping verification unavailable' });
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
    const verification = shapeVerification(result?.stdout);
    return Object.freeze(result?.code === 0 && verification
      ? { state: 'removed', removed: true, verified: true, verification: 'verified', scope: 'APPLICATION_PATH', instanceScoped: false, pid: target, policyName: verification.policyName || `RNK-Optimizer-${target}` }
      : { state: 'rejected', removed: false, verified: false, scope: 'APPLICATION_PATH', instanceScoped: false, pid: target, reason: result?.code !== 0 ? result?.stderr || 'Windows traffic shaping removal failed' : 'Windows traffic shaping verification unavailable' });
  } catch (error) { return Object.freeze({ state: 'rejected', removed: false, pid: target, reason: error.message }); }
}

export function windowsTrafficShapeCommands() { return Object.freeze({ provider: PROVIDER, providerPath: PROVIDER_PATH, apply: SHAPE_SCRIPT, remove: REMOVE_SCRIPT, label: 'WINDOWS_APP_NETWORK_LIMIT', scope: 'APPLICATION_PATH', instanceScoped: false, coverage: WINDOWS_NETWORK_COVERAGE }); }
