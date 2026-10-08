/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Allow-listed web-media panel authority. It opens one approved HTTPS URL in
 * the platform default browser through the shell-free command runner; it does
 * not download, scrape, or bypass service restrictions.
 */

import { buildMediaPanelPlan, MEDIA_PLAYER_VERSION } from './media-player.js';

export const MEDIA_PANEL_VERSION = MEDIA_PLAYER_VERSION;
const OPENERS = Object.freeze({
  win32: 'explorer.exe',
  linux: 'xdg-open',
  darwin: 'open'
});

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function openerFor(platform) { return OPENERS[text(platform)?.toLowerCase()] || null; }

export function buildMediaPanelOpenPlan(url, { platform = process.platform, allowedHosts } = {}) {
  const base = buildMediaPanelPlan(url, allowedHosts === undefined ? {} : { allowedHosts });
  if (base.state !== 'review-ready') return Object.freeze(base);
  const opener = openerFor(platform);
  if (!opener) return Object.freeze({ ...base, state: 'unsupported-platform', platform, reason: 'platform default-browser opener is unavailable' });
  return Object.freeze({ ...base, version: MEDIA_PANEL_VERSION, platform: text(platform)?.toLowerCase(), operation: 'open-media-panel', command: Object.freeze({ file: opener, args: Object.freeze([base.url]) }), mutation: 'none' });
}

export async function applyMediaPanelOpen(plan, { commandRunner, approved = false, dryRun = true } = {}) {
  if (!plan || typeof plan !== 'object' || plan.version !== MEDIA_PANEL_VERSION || plan.operation !== 'open-media-panel') throw new TypeError('Media panel open plan is invalid');
  if (!commandRunner || typeof commandRunner.run !== 'function') throw new TypeError('Media panel opening requires a command runner');
  if (plan.state !== 'review-ready') return Object.freeze({ state: 'refused', applied: false, reason: plan.reason || 'media panel plan is not ready' });
  if (!approved) return Object.freeze({ state: 'approval-required', applied: false, url: plan.url });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, url: plan.url });
  try {
    const result = await commandRunner.run(plan.command.file, plan.command.args, { timeoutMs: 5000, maxOutputBytes: 1024 });
    return Object.freeze(result?.code === 0 ? { state: 'applied', applied: true, url: plan.url, command: plan.command.file } : { state: 'rejected', applied: false, url: plan.url, reason: result?.stderr || 'default-browser opener failed' });
  } catch (error) { return Object.freeze({ state: 'rejected', applied: false, url: plan.url, reason: error.message }); }
}
