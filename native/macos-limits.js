/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * macOS hard limits are launchd limits for future child jobs. Existing PIDs
 * are refused because macOS does not expose a safe portable way to attach a
 * per-process CPU/RAM hard limit after launch.
 */

export const MACOS_LIMITS_VERSION = 1;
const MIN_MEMORY = 16 * 1024 ** 2;
const MAX_MEMORY = 1024 ** 4;
const MAX_CPU_SECONDS = 86400;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function positiveInteger(value, max) { return Number.isInteger(value) && value > 0 && value <= max ? value : null; }
function label(value) { const result = text(value); return result && /^[A-Za-z0-9._-]{1,64}$/u.test(result) ? result : null; }
function memory(value) { return Number.isInteger(value) && value >= MIN_MEMORY && value <= MAX_MEMORY ? value : null; }
function xml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;'); }
function invalid(reason) { return Object.freeze({ version: MACOS_LIMITS_VERSION, state: 'invalid', reason }); }

export function previewMacosHardLimits({ targetPid, cpuSeconds, memoryBytes } = {}) {
  if (!positiveInteger(targetPid, 2147483647)) return invalid('existing-process hard limits require a valid target PID');
  if (!positiveInteger(cpuSeconds, MAX_CPU_SECONDS) && !memory(memoryBytes)) return invalid('at least one bounded CPU or RAM limit is required');
  return Object.freeze({ version: MACOS_LIMITS_VERSION, state: 'unsupported-existing-process', targetPid, cpuSeconds: positiveInteger(cpuSeconds, MAX_CPU_SECONDS), memoryBytes: memory(memoryBytes), reason: 'macOS hard CPU/RAM limits are launch-time controls; existing PIDs are not modified' });
}

export function previewMacosLaunchLimits({ label: requestedLabel, executable, args = [], cpuSeconds, memoryBytes } = {}) {
  const jobLabel = label(requestedLabel);
  const command = text(executable);
  const cpu = positiveInteger(cpuSeconds, MAX_CPU_SECONDS);
  const memoryLimit = memory(memoryBytes);
  if (!jobLabel) return invalid('launch limit label is invalid');
  if (!command || !command.startsWith('/')) return invalid('launch limit executable must be an absolute path');
  if (!Array.isArray(args) || args.length > 32 || args.some((item) => typeof item !== 'string' || item.length > 1024)) return invalid('launch limit arguments are invalid');
  if (!cpu && !memoryLimit) return invalid('at least one bounded CPU or RAM limit is required');
  const hard = {};
  if (cpu) hard.CPUTime = cpu;
  if (memoryLimit) hard.ResidentSetSize = memoryLimit;
  const programArguments = [command, ...args].map((item) => `<string>${xml(item)}</string>`).join('');
  const limits = Object.entries(hard).map(([key, value]) => `<key>${key}</key><integer>${value}</integer>`).join('');
  const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${xml(jobLabel)}</string><key>ProgramArguments</key><array>${programArguments}</array><key>HardResourceLimits</key><dict>${limits}</dict></dict></plist>`;
  return Object.freeze({ version: MACOS_LIMITS_VERSION, state: 'plan-ready', label: jobLabel, executable: command, args: Object.freeze([...args]), cpuSeconds: cpu, memoryBytes: memoryLimit, plist });
}

function commandResult(result, state, plan) { return Object.freeze(result?.code === 0 ? { state, applied: state === 'applied', label: plan.label } : { state: 'rejected', applied: false, label: plan.label, reason: result?.stderr || `launchctl ${state} failed` }); }

export async function applyMacosLaunchLimits(plan, { commandRunner, fsImpl, pathImpl, stateRoot = '/tmp', userId = '0', approved = false, dryRun = true } = {}) {
  if (!plan || plan.version !== MACOS_LIMITS_VERSION || plan.state !== 'plan-ready') throw new TypeError('macOS launch limit plan is invalid');
  if (!approved) return Object.freeze({ state: 'approval-required', applied: false, label: plan.label });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, label: plan.label });
  if (!commandRunner || typeof commandRunner.run !== 'function' || !fsImpl || typeof fsImpl.mkdir !== 'function' || typeof fsImpl.writeFile !== 'function' || !pathImpl || typeof pathImpl.join !== 'function') return Object.freeze({ state: 'unavailable', applied: false, label: plan.label, reason: 'macOS launch authority dependencies are unavailable' });
  const directory = pathImpl.join(stateRoot, 'rnk-optimizer-launch');
  const plistPath = pathImpl.join(directory, `${plan.label}.plist`);
  try {
    await fsImpl.mkdir(directory, { recursive: true });
    await fsImpl.writeFile(plistPath, plan.plist, 'utf8');
    const result = await commandRunner.run('launchctl', ['bootstrap', `gui/${userId}`, plistPath], { timeoutMs: 10000, maxOutputBytes: 8192 });
    return commandResult(result, 'applied', plan);
  } catch (error) { return Object.freeze({ state: 'rejected', applied: false, label: plan.label, reason: error.message }); }
}

export async function removeMacosLaunchLimits(labelValue, { commandRunner, userId = '0', approved = false, dryRun = true } = {}) {
  const jobLabel = label(labelValue);
  if (!jobLabel) throw new Error('macOS launch limit label is invalid');
  if (!approved) return Object.freeze({ state: 'approval-required', removed: false, label: jobLabel });
  if (dryRun) return Object.freeze({ state: 'preview', removed: false, label: jobLabel });
  if (!commandRunner || typeof commandRunner.run !== 'function') return Object.freeze({ state: 'unavailable', removed: false, label: jobLabel, reason: 'command runner unavailable' });
  try {
    const result = await commandRunner.run('launchctl', ['bootout', `gui/${userId}/${jobLabel}`], { timeoutMs: 10000, maxOutputBytes: 8192 });
    return Object.freeze(result?.code === 0 ? { state: 'removed', removed: true, label: jobLabel } : { state: 'rejected', removed: false, label: jobLabel, reason: result?.stderr || 'launchctl removal failed' });
  } catch (error) { return Object.freeze({ state: 'rejected', removed: false, label: jobLabel, reason: error.message }); }
}
