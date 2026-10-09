/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Approval-gated local report viewer. It opens one explicit HTML artifact
 * through a fixed platform opener and never starts a server or fetches URLs.
 */

import path from 'path';

export const REPORT_VIEWER_VERSION = 1;
const OPENERS = Object.freeze({ win32: 'explorer.exe', linux: 'xdg-open', darwin: 'open' });

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function opener(platform) { return OPENERS[text(platform)?.toLowerCase()] || null; }
function localHtml(value, pathImpl) {
  const candidate = text(value);
  if (!candidate || candidate.includes('\0') || /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) || !/\.html?$/i.test(candidate)) return null;
  return pathImpl.resolve(candidate);
}

export function buildReportViewerPlan(filePath, { platform = process.platform, pathImpl = path } = {}) {
  const root = localHtml(filePath, pathImpl);
  if (!root) return Object.freeze({ version: REPORT_VIEWER_VERSION, state: 'refused', platform, operation: null, reason: 'an explicit local HTML report path is required' });
  const command = opener(platform);
  if (!command) return Object.freeze({ version: REPORT_VIEWER_VERSION, state: 'unsupported-platform', platform, operation: 'open-workstation-report', path: root, reason: 'platform report opener is unavailable', mutation: 'none' });
  return Object.freeze({ version: REPORT_VIEWER_VERSION, state: 'review-ready', platform, operation: 'open-workstation-report', path: root, command: Object.freeze({ file: command, args: Object.freeze([root]) }), mutation: 'none', requiresApproval: true });
}

export async function applyReportViewer(plan, { commandRunner, approved = false, dryRun = true } = {}) {
  if (!plan || typeof plan !== 'object' || plan.version !== REPORT_VIEWER_VERSION || plan.operation !== 'open-workstation-report') throw new TypeError('Report viewer plan is invalid');
  if (!commandRunner || typeof commandRunner.run !== 'function') throw new TypeError('Report viewer requires a command runner');
  if (plan.state !== 'review-ready') return Object.freeze({ state: 'refused', applied: false, reason: plan.reason || 'report viewer plan is not ready' });
  if (!approved) return Object.freeze({ state: 'approval-required', applied: false, path: plan.path });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, path: plan.path });
  try {
    const result = await commandRunner.run(plan.command.file, plan.command.args, { timeoutMs: 5000, maxOutputBytes: 1024 });
    return Object.freeze(result?.code === 0 ? { state: 'applied', applied: true, path: plan.path, command: plan.command.file } : { state: 'rejected', applied: false, path: plan.path, reason: result?.stderr || 'report opener failed' });
  } catch (error) { return Object.freeze({ state: 'rejected', applied: false, path: plan.path, reason: error.message }); }
}
