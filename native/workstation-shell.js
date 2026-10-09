/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Cross-platform local dashboard session. It composes the existing snapshot
 * and report viewer authorities without a listener, shell, service, or tray.
 */

import path from 'path';

export const WORKSTATION_SHELL_VERSION = 1;
const OPENERS = Object.freeze({ win32: 'explorer.exe', linux: 'xdg-open', darwin: 'open' });

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function absolute(value, pathImpl) { const resolved = text(value); return resolved && pathImpl.isAbsolute(resolved) ? resolved : null; }
function opener(platform) { return OPENERS[text(platform)?.toLowerCase()] || null; }

export function buildWorkstationShellPlan({ platform = process.platform, historyPath, reportPath, cliPath, nodePath = process.execPath, pathImpl = path } = {}) {
  const history = absolute(historyPath, pathImpl);
  const report = absolute(reportPath, pathImpl);
  const cli = absolute(cliPath, pathImpl);
  const command = opener(platform);
  const base = { version: WORKSTATION_SHELL_VERSION, operation: 'open-workstation-dashboard', platform: text(platform)?.toLowerCase() || 'unknown', mutation: 'write-local-report', requiresApproval: true };
  if (!history || !report || !cli || !absolute(nodePath, pathImpl)) return Object.freeze({ ...base, state: 'invalid-input', reason: 'absolute history, report, CLI, and runtime paths are required' });
  if (!report.toLowerCase().endsWith('.html')) return Object.freeze({ ...base, state: 'invalid-input', reportPath: report, reason: 'dashboard output must be an HTML file' });
  if (!command) return Object.freeze({ ...base, state: 'unsupported-platform', historyPath: history, reportPath: report, reason: 'platform default opener is unavailable' });
  return Object.freeze({ ...base, state: 'review-ready', historyPath: history, reportPath: report, commands: Object.freeze([
    Object.freeze({ file: nodePath, args: Object.freeze([cli, 'steward-snapshot', '--path', history, '--output-path', report, '--format', 'html']) }),
    Object.freeze({ file: command, args: Object.freeze([report]) })
  ]) });
}

function validPlan(plan) {
  return Boolean(plan) && typeof plan === 'object' && plan.version === WORKSTATION_SHELL_VERSION && plan.state === 'review-ready' && plan.operation === 'open-workstation-dashboard' && Array.isArray(plan.commands) && plan.commands.length === 2;
}

export async function applyWorkstationShell(plan, { commandRunner, approved = false, dryRun = true } = {}) {
  if (!validPlan(plan)) return Object.freeze({ state: 'refused', applied: false, reason: 'dashboard shell plan is not ready' });
  if (!approved) return Object.freeze({ state: 'refused', applied: false, reason: 'dashboard shell approval is required' });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, plan });
  if (!commandRunner || typeof commandRunner.run !== 'function') throw new TypeError('dashboard shell requires a command runner');
  const snapshot = await commandRunner.run(plan.commands[0].file, plan.commands[0].args, { timeoutMs: 30000, maxOutputBytes: 65536 });
  if (snapshot?.code !== 0) return Object.freeze({ state: 'rejected', applied: false, stage: 'snapshot', reason: snapshot?.stderr || 'dashboard snapshot failed' });
  const open = await commandRunner.run(plan.commands[1].file, plan.commands[1].args, { timeoutMs: 5000, maxOutputBytes: 1024 });
  if (open?.code !== 0) return Object.freeze({ state: 'rejected', applied: false, stage: 'open', reason: open?.stderr || 'dashboard opener failed' });
  return Object.freeze({ state: 'applied', applied: true, reportPath: plan.reportPath, command: plan.commands[1].file });
}
