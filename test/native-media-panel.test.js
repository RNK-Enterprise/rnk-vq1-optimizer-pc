/**
 * Native media panel tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { applyMediaPanelOpen, buildMediaPanelOpenPlan, MEDIA_PANEL_VERSION } from '../native/media-panel.js';

describe('native allow-listed media panel authority', () => {
  test('builds fixed browser plans only for approved HTTPS hosts', () => {
    expect(buildMediaPanelOpenPlan()).toMatchObject({ state: 'refused' });
    expect(buildMediaPanelOpenPlan('http://www.youtube.com/watch?v=x', { platform: 'linux' })).toMatchObject({ state: 'refused' });
    expect(buildMediaPanelOpenPlan('https://example.com/media', { platform: 'linux' })).toMatchObject({ state: 'refused' });
    expect(buildMediaPanelOpenPlan('https://www.youtube.com/watch?v=x', { platform: 'linux' })).toMatchObject({ version: MEDIA_PANEL_VERSION, state: 'review-ready', operation: 'open-media-panel', command: { file: 'xdg-open', args: ['https://www.youtube.com/watch?v=x'] } });
    expect(buildMediaPanelOpenPlan('https://www.youtube.com/watch?v=x', { platform: 'win32' })).toMatchObject({ command: { file: 'explorer.exe' } });
    expect(buildMediaPanelOpenPlan('https://www.youtube.com/watch?v=x', { platform: 'darwin' })).toMatchObject({ command: { file: 'open' } });
    expect(buildMediaPanelOpenPlan('https://www.youtube.com/watch?v=x', { platform: 'plan9' })).toMatchObject({ state: 'unsupported-platform' });
    expect(buildMediaPanelOpenPlan('https://www.youtube.com/watch?v=x', { platform: null })).toMatchObject({ state: 'unsupported-platform' });
    expect(buildMediaPanelOpenPlan('https://example.com/media', { platform: 'linux', allowedHosts: ['example.com'] })).toMatchObject({ operation: 'open-media-panel' });
  });

  test('requires confirmation and reports fixed browser opener outcomes', async () => {
    const plan = buildMediaPanelOpenPlan('https://www.youtube.com/watch?v=x', { platform: 'linux' });
    await expect(applyMediaPanelOpen(plan)).rejects.toThrow('command runner');
    expect(await applyMediaPanelOpen({ version: MEDIA_PANEL_VERSION, state: 'unsupported-platform', operation: 'open-media-panel', reason: 'blocked' }, { commandRunner: { run: jest.fn() } })).toMatchObject({ state: 'refused' });
    expect(await applyMediaPanelOpen({ version: MEDIA_PANEL_VERSION, state: 'unsupported-platform', operation: 'open-media-panel' }, { commandRunner: { run: jest.fn() } })).toMatchObject({ state: 'refused', reason: 'media panel plan is not ready' });
    expect(await applyMediaPanelOpen(plan, { commandRunner: { run: jest.fn() } })).toMatchObject({ state: 'approval-required' });
    expect(await applyMediaPanelOpen(plan, { commandRunner: { run: jest.fn() }, approved: true })).toMatchObject({ state: 'preview' });
    const run = jest.fn().mockResolvedValue({ code: 0 });
    expect(await applyMediaPanelOpen(plan, { commandRunner: { run }, approved: true, dryRun: false })).toMatchObject({ state: 'applied', applied: true });
    expect(run).toHaveBeenCalledWith('xdg-open', ['https://www.youtube.com/watch?v=x'], { timeoutMs: 5000, maxOutputBytes: 1024 });
    expect(await applyMediaPanelOpen(plan, { commandRunner: { run: jest.fn().mockResolvedValue({ code: 1, stderr: 'denied' }) }, approved: true, dryRun: false })).toMatchObject({ state: 'rejected', reason: 'denied' });
    expect(await applyMediaPanelOpen(plan, { commandRunner: { run: jest.fn().mockResolvedValue({ code: 1 }) }, approved: true, dryRun: false })).toMatchObject({ state: 'rejected', reason: 'default-browser opener failed' });
    expect(await applyMediaPanelOpen(plan, { commandRunner: { run: jest.fn().mockRejectedValue(new Error('failed')) }, approved: true, dryRun: false })).toMatchObject({ state: 'rejected', reason: 'failed' });
  });

  test('rejects malformed plans', async () => {
    await expect(applyMediaPanelOpen(null, { commandRunner: { run: jest.fn() } })).rejects.toThrow('invalid');
  });
});
