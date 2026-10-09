/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Explicit user-level daily-report schedule authority. Each platform uses its
 * documented per-user scheduler; preview is data-only and apply/restore are
 * approval-gated. No root service or privileged daemon is installed.
 */

import fs from 'fs/promises';
import path from 'path';

export const REPORT_SCHEDULER_VERSION = 1;
const FORMATS = Object.freeze(['json', 'markdown']);
const TASK_PREFIX = 'RNK-Optimizer-Daily-Report';
const NAME_PATTERN = /^[A-Za-z0-9._ -]{1,80}$/;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function formatName(value) {
  const normalized = text(value) || 'json';
  if (!FORMATS.includes(normalized)) throw new Error(`Unsupported report format: ${normalized}`);
  return normalized;
}
function safeName(value) {
  const name = text(value) || TASK_PREFIX;
  if (!NAME_PATTERN.test(name) || !name.startsWith(TASK_PREFIX)) throw new Error('Report schedule name must use the fixed RNK prefix');
  return name;
}
function absolute(value, name, pathImpl) {
  const result = text(value);
  if (!result || !pathImpl.isAbsolute(result) || result.length > 4096 || /[\u0000\r\n]/.test(result)) throw new Error(`Report schedule ${name} must be an absolute safe path`);
  return pathImpl.normalize(result);
}
function scheduleTime(value) {
  const raw = text(value) || '09:00';
  const match = /^(\d{2}):(\d{2})$/.exec(raw);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error('Report schedule time must be HH:MM');
  return { time: raw, hour: Number(match[1]), minute: Number(match[2]) };
}
function commandArgs(plan) {
  return [plan.cliPath, 'steward-report', '--path', plan.historyPath, '--output-path', plan.outputPath, '--format', plan.format];
}
function windowsQuote(value) {
  const raw = String(value);
  return /[\s"]/u.test(raw) ? `"${raw.replaceAll('"', '\\"')}"` : raw;
}
function windowsArguments(plan) { return commandArgs(plan).map(windowsQuote).join(' '); }
function systemdQuote(value) { return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`; }
function plistEscape(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function plistArguments(plan) { return commandArgs(plan).map((value) => `    <string>${plistEscape(value)}</string>`).join('\n'); }
function userHome(env, pathImpl) { return text(env?.HOME) || pathImpl.parse('/').root; }

function platformPlan(config) {
  const { platform, pathImpl, env } = config;
  if (platform === 'linux') {
    const configRoot = text(env?.XDG_CONFIG_HOME) || pathImpl.join(userHome(env, pathImpl), '.config');
    const unitRoot = pathImpl.join(configRoot, 'systemd', 'user');
    const serviceName = `${config.taskName}.service`;
    const timerName = `${config.taskName}.timer`;
    return {
      authority: 'systemd-user',
      servicePath: pathImpl.join(unitRoot, serviceName),
      timerPath: pathImpl.join(unitRoot, timerName),
      serviceName,
      timerName,
      files: {
        service: `[Unit]\nDescription=RNK daily workstation report\n\n[Service]\nType=oneshot\nExecStart=${systemdQuote(config.nodePath)} ${commandArgs(config).map(systemdQuote).join(' ')}\n`,
        timer: `[Unit]\nDescription=RNK daily workstation report timer\n\n[Timer]\nOnCalendar=*-*-* ${config.schedule.time}:00\nPersistent=true\nUnit=${serviceName}\n\n[Install]\nWantedBy=timers.target\n`
      }
    };
  }
  if (platform === 'darwin') {
    const launchRoot = pathImpl.join(userHome(env, pathImpl), 'Library', 'LaunchAgents');
    const label = config.taskName.replaceAll(' ', '.');
    return {
      authority: 'launchd-user',
      label,
      plistPath: pathImpl.join(launchRoot, `${label}.plist`),
      files: { plist: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>${plistEscape(label)}</string>\n  <key>ProgramArguments</key><array>\n    <string>${plistEscape(config.nodePath)}</string>\n${plistArguments(config)}\n  </array>\n  <key>StartCalendarInterval</key><dict>\n    <key>Hour</key><integer>${config.schedule.hour}</integer>\n    <key>Minute</key><integer>${config.schedule.minute}</integer>\n  </dict>\n</dict></plist>\n` }
    };
  }
  if (platform === 'win32') {
    return { authority: 'windows-task-scheduler', taskName: config.taskName, command: { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '$action=New-ScheduledTaskAction -Execute $args[0] -Argument $args[1];$trigger=New-ScheduledTaskTrigger -Daily -At $args[2];Register-ScheduledTask -TaskName $args[3] -Action $action -Trigger $trigger -Force -ErrorAction Stop', '--', config.nodePath, windowsArguments(config), config.schedule.time, config.taskName] } };
  }
  return { authority: null };
}

export function previewReportSchedule({
  platform = process.platform,
  nodePath = process.execPath,
  cliPath = path.resolve('native', 'cli.mjs'),
  historyPath,
  outputPath,
  format = 'json',
  time = '09:00',
  taskName = TASK_PREFIX,
  env = process.env,
  pathImpl = path
} = {}) {
  const config = {
    version: REPORT_SCHEDULER_VERSION,
    platform: text(platform) || 'unknown',
    nodePath: absolute(nodePath, 'node path', pathImpl),
    cliPath: absolute(cliPath, 'CLI path', pathImpl),
    historyPath: absolute(historyPath, 'history path', pathImpl),
    outputPath: absolute(outputPath, 'output path', pathImpl),
    format: formatName(format),
    schedule: scheduleTime(time),
    taskName: safeName(taskName),
    env,
    pathImpl
  };
  const platformDetails = platformPlan(config);
  if (!platformDetails.authority) return Object.freeze({ version: REPORT_SCHEDULER_VERSION, state: 'unsupported-platform', platform: config.platform, reason: 'user-level report scheduling is unavailable on this platform' });
  return Object.freeze({ version: REPORT_SCHEDULER_VERSION, state: 'plan-ready', operation: 'install-daily-report-schedule', platform: config.platform, authority: platformDetails.authority, taskName: config.taskName, schedule: config.schedule, historyPath: config.historyPath, outputPath: config.outputPath, format: config.format, nodePath: config.nodePath, cliPath: config.cliPath, details: Object.freeze(platformDetails), requiresApproval: true, reversible: true });
}

function validatePlan(plan) {
  if (!record(plan) || plan.version !== REPORT_SCHEDULER_VERSION || plan.state !== 'plan-ready' || plan.operation !== 'install-daily-report-schedule') throw new TypeError('Report schedule plan is invalid');
  if (!['linux', 'darwin', 'win32'].includes(plan.platform) || !text(plan.taskName) || !text(plan.nodePath) || !text(plan.cliPath)) throw new TypeError('Report schedule plan fields are invalid');
  return plan;
}
async function writeFile(fsImpl, filePath, content, pathImpl) {
  await fsImpl.mkdir(pathImpl.dirname(filePath), { recursive: true, mode: 0o700 });
  await fsImpl.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
}
async function removeFiles(fsImpl, paths) {
  for (const filePath of paths) await fsImpl.rm(filePath, { force: true });
}
function commandResult(result, operation) { return result?.code === 0 ? { ok: true } : { ok: false, reason: result?.stderr || `${operation} failed` }; }
async function runCommand(commandRunner, file, args, operation) {
  if (!commandRunner || typeof commandRunner.run !== 'function') return { ok: false, reason: `${operation} command authority is unavailable` };
  try { return commandResult(await commandRunner.run(file, args), operation); } catch (error) { return { ok: false, reason: error.message }; }
}

export async function applyReportSchedule(plan, { approved = false, dryRun = true, fsImpl = fs, pathImpl = path, commandRunner, uid = process.getuid?.() } = {}) {
  validatePlan(plan);
  if (!approved && !dryRun) return Object.freeze({ state: 'approval-required', applied: false, reason: 'explicit approval is required' });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, plan });
  let result;
  const files = plan.platform === 'linux' ? [plan.details.servicePath, plan.details.timerPath] : plan.platform === 'darwin' ? [plan.details.plistPath] : [];
  try {
    if (plan.platform === 'linux') {
      await writeFile(fsImpl, plan.details.servicePath, plan.details.files.service, pathImpl);
      await writeFile(fsImpl, plan.details.timerPath, plan.details.files.timer, pathImpl);
      result = await runCommand(commandRunner, 'systemctl', ['--user', 'daemon-reload'], 'systemd user daemon reload');
      if (result.ok) result = await runCommand(commandRunner, 'systemctl', ['--user', 'enable', '--now', plan.details.timerName], 'systemd user timer enable');
    } else if (plan.platform === 'darwin') {
      await writeFile(fsImpl, plan.details.plistPath, plan.details.files.plist, pathImpl);
      result = await runCommand(commandRunner, 'launchctl', ['bootstrap', `gui/${uid}`, plan.details.plistPath], 'launchd user bootstrap');
    } else {
      result = await runCommand(commandRunner, plan.details.command.file, plan.details.command.args, 'Windows task registration');
    }
  } catch (error) {
    result = { ok: false, reason: error.message };
  }
  if (!result.ok && files.length > 0) {
    try { await removeFiles(fsImpl, files); } catch (error) { result = { ok: false, reason: `${result.reason}; schedule artifact cleanup failed: ${error.message}` }; }
  }
  return Object.freeze(result.ok ? { state: 'applied', applied: true, receipt: Object.freeze({ version: REPORT_SCHEDULER_VERSION, action: 'remove-daily-report-schedule', platform: plan.platform, authority: plan.authority, taskName: plan.taskName, details: plan.details }) } : { state: 'rejected', applied: false, reason: result.reason });
}

export async function restoreReportSchedule(receipt, { approved = false, dryRun = true, fsImpl = fs, commandRunner, uid = process.getuid?.() } = {}) {
  if (!record(receipt) || receipt.version !== REPORT_SCHEDULER_VERSION || receipt.action !== 'remove-daily-report-schedule') throw new TypeError('Report schedule receipt is invalid');
  if (!approved && !dryRun) return Object.freeze({ state: 'approval-required', restored: false, reason: 'explicit approval is required' });
  if (dryRun) return Object.freeze({ state: 'preview', restored: false, receipt });
  let result;
  if (receipt.platform === 'linux') result = await runCommand(commandRunner, 'systemctl', ['--user', 'disable', '--now', receipt.details.timerName], 'systemd user timer removal');
  else if (receipt.platform === 'darwin') result = await runCommand(commandRunner, 'launchctl', ['bootout', `gui/${uid}`, receipt.details.plistPath], 'launchd user bootout');
  else if (receipt.platform === 'win32') result = await runCommand(commandRunner, receipt.details.command?.file || 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Unregister-ScheduledTask -TaskName $args[0] -Confirm:$false -ErrorAction Stop', '--', receipt.taskName], 'Windows task removal');
  else return Object.freeze({ state: 'rejected', restored: false, reason: `unsupported report schedule platform: ${receipt.platform}` });
  if (!result.ok) return Object.freeze({ state: 'rejected', restored: false, reason: result.reason });
  const paths = receipt.platform === 'linux' ? [receipt.details.servicePath, receipt.details.timerPath] : receipt.platform === 'darwin' ? [receipt.details.plistPath] : [];
  for (const filePath of paths) {
    try { await fsImpl.rm(filePath, { force: true }); } catch (error) { return Object.freeze({ state: 'rejected', restored: false, reason: error.message }); }
  }
  return Object.freeze({ state: 'restored', restored: true });
}
