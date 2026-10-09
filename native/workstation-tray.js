/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Approval-gated native tray session. It writes one local HTML snapshot, then
 * starts a fixed platform tray host that can open that explicit artifact.
 */

import path from 'path';

export const WORKSTATION_TRAY_VERSION = 1;
const PLATFORMS = Object.freeze(['win32', 'linux', 'darwin']);
const WINDOWS_SCRIPT = '$report=$args[0];Add-Type -AssemblyName System.Windows.Forms;Add-Type -AssemblyName System.Drawing;$notify=New-Object System.Windows.Forms.NotifyIcon;$notify.Icon=[System.Drawing.SystemIcons]::Application;$notify.Text="RNK Optimizer";$menu=New-Object System.Windows.Forms.ContextMenuStrip;$open=$menu.Items.Add("Open dashboard");$exit=$menu.Items.Add("Exit");$open.Add_Click({Start-Process -FilePath $report});$exit.Add_Click({$notify.Visible=$false;$context.ExitThread()});$notify.ContextMenuStrip=$menu;$notify.Visible=$true;$context=New-Object System.Windows.Forms.ApplicationContext;[System.Windows.Forms.Application]::Run($context)';
const MACOS_SCRIPT = 'use framework "Cocoa"\nproperty reportPath : ""\non run argv\n set reportPath to (item 1 of argv)\n set app to current application\n set statusItem to (app\'s NSStatusBar\'s systemStatusBar()\'s statusItemWithLength:-1)\n statusItem\'s button()\'s setTitle:"RNK"\n set menu to app\'s NSMenu\'s alloc()\'s init()\n set openItem to app\'s NSMenuItem\'s alloc()\'s initWithTitle:"Open dashboard" action:"openDashboard:" keyEquivalent:""\n openItem\'s setTarget:me\n menu\'s addItem:openItem\n set quitItem to app\'s NSMenuItem\'s alloc()\'s initWithTitle:"Quit" action:"quitTray:" keyEquivalent:"q"\n quitItem\'s setTarget:me\n menu\'s addItem:quitItem\n statusItem\'s setMenu:menu\n app\'s NSApp\'s setActivationPolicy:1\n app\'s NSApp\'s run()\nend run\non openDashboard:sender\n do shell script "open " & quoted form of reportPath\nend openDashboard:\non quitTray:sender\n current application\'s NSApp\'s terminate:me\nend quitTray:';

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function absolute(value, pathImpl) { const resolved = text(value); return resolved && pathImpl.isAbsolute(resolved) ? pathImpl.resolve(resolved) : null; }
function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\\"'\\\"'")}'`; }
function trayCommand(platform, reportPath) {
  if (platform === 'win32') return { file: 'powershell.exe', args: Object.freeze(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SCRIPT, '--', reportPath]) };
  if (platform === 'linux') return { file: 'yad', args: Object.freeze(['--notification', '--image=utilities-system-monitor', '--text=RNK Optimizer', `--menu=Open!xdg-open ${shellQuote(reportPath)}\nQuit!quit`]) };
  return { file: 'osascript', args: Object.freeze(['-l', 'AppleScript', '-e', MACOS_SCRIPT, reportPath]) };
}

export function buildWorkstationTrayPlan({ platform = process.platform, historyPath, reportPath, cliPath, nodePath = process.execPath, pathImpl = path } = {}) {
  const normalizedPlatform = text(platform)?.toLowerCase() || 'unknown';
  const history = absolute(historyPath, pathImpl);
  const report = absolute(reportPath, pathImpl);
  const cli = absolute(cliPath, pathImpl);
  const runtime = absolute(nodePath, pathImpl);
  const base = { version: WORKSTATION_TRAY_VERSION, operation: 'run-workstation-tray', platform: normalizedPlatform, mutation: 'write-local-report-and-start-tray', requiresApproval: true, reversible: true };
  if (!PLATFORMS.includes(normalizedPlatform)) return Object.freeze({ ...base, state: 'unsupported-platform', reason: 'tray plans support Windows, Linux, and macOS' });
  if (!history || !report || !cli || !runtime) return Object.freeze({ ...base, state: 'invalid-input', reason: 'absolute history, report, CLI, and runtime paths are required' });
  if (!report.toLowerCase().endsWith('.html')) return Object.freeze({ ...base, state: 'invalid-input', reportPath: report, reason: 'tray report must be an HTML file' });
  const tray = trayCommand(normalizedPlatform, report);
  return Object.freeze({ ...base, state: 'review-ready', historyPath: history, reportPath: report, commands: Object.freeze([
    Object.freeze({ file: runtime, args: Object.freeze([cli, 'steward-snapshot', '--path', history, '--output-path', report, '--format', 'html']) }),
    Object.freeze(tray)
  ]) });
}

function validPlan(plan) { return Boolean(plan) && typeof plan === 'object' && plan.version === WORKSTATION_TRAY_VERSION && plan.state === 'review-ready' && plan.operation === 'run-workstation-tray' && Array.isArray(plan.commands) && plan.commands.length === 2; }

export async function applyWorkstationTray(plan, { commandRunner, approved = false, dryRun = true } = {}) {
  if (!validPlan(plan)) return Object.freeze({ state: 'refused', applied: false, reason: 'tray plan is not ready' });
  if (!approved) return Object.freeze({ state: 'approval-required', applied: false, reason: 'tray approval is required' });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, plan });
  if (!commandRunner || typeof commandRunner.run !== 'function') throw new TypeError('tray requires a command runner');
  try {
    const snapshot = await commandRunner.run(plan.commands[0].file, plan.commands[0].args, { timeoutMs: 30000, maxOutputBytes: 65536 });
    if (snapshot?.code !== 0) return Object.freeze({ state: 'rejected', applied: false, stage: 'snapshot', reason: snapshot?.stderr || 'tray snapshot failed' });
    const tray = await commandRunner.run(plan.commands[1].file, plan.commands[1].args, { timeoutMs: 0, maxOutputBytes: 4096 });
    return Object.freeze(tray?.code === 0 ? { state: 'applied', applied: true, reportPath: plan.reportPath, command: plan.commands[1].file } : { state: 'rejected', applied: false, stage: 'tray', reason: tray?.stderr || 'tray host failed' });
  } catch (error) { return Object.freeze({ state: 'rejected', applied: false, stage: 'tray', reason: error.message }); }
}
