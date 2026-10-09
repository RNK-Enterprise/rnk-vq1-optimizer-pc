/**
 * Native report viewer tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { applyReportViewer, buildReportViewerPlan, REPORT_VIEWER_VERSION } from '../native/report-viewer.js';
import path from 'path';

describe('native report viewer', () => {
  test('builds fixed local HTML opener plans and refuses unsafe paths', () => {
    expect(buildReportViewerPlan('/tmp/report.html', { platform: 'linux', pathImpl: path.posix })).toMatchObject({ version: REPORT_VIEWER_VERSION, state: 'review-ready', command: { file: 'xdg-open', args: ['/tmp/report.html'] }, mutation: 'none' });
    expect(buildReportViewerPlan('C:\\reports\\daily.htm', { platform: 'win32', pathImpl: path.win32 })).toMatchObject({ state: 'review-ready', command: { file: 'explorer.exe' } });
    expect(buildReportViewerPlan('https://example.test/report.html', { platform: 'linux', pathImpl: path.posix })).toMatchObject({ state: 'refused' });
    expect(buildReportViewerPlan('/tmp/report.json', { platform: 'linux', pathImpl: path.posix })).toMatchObject({ state: 'refused' });
    expect(buildReportViewerPlan('/tmp/report.html\0bad', { platform: 'linux', pathImpl: path.posix })).toMatchObject({ state: 'refused' });
    expect(buildReportViewerPlan('/tmp/report.html', { platform: 'freebsd', pathImpl: path.posix })).toMatchObject({ state: 'unsupported-platform' });
    expect(buildReportViewerPlan()).toMatchObject({ state: 'refused' });
    expect(buildReportViewerPlan('')).toMatchObject({ state: 'refused' });
  });

  test('requires approval, applies through the fixed opener, and fails closed', async () => {
    const plan = buildReportViewerPlan('/tmp/report.html', { platform: 'linux', pathImpl: path.posix });
    await expect(applyReportViewer(plan)).rejects.toThrow('command runner');
    expect(await applyReportViewer({ ...plan, state: 'unsupported-platform', reason: 'blocked' }, { commandRunner: { run: jest.fn() } })).toMatchObject({ state: 'refused', reason: 'blocked' });
    expect(await applyReportViewer({ ...plan, state: 'unsupported-platform' }, { commandRunner: { run: jest.fn() } })).toMatchObject({ state: 'refused', reason: 'report viewer plan is not ready' });
    expect(await applyReportViewer(plan, { commandRunner: { run: jest.fn() } })).toMatchObject({ state: 'approval-required' });
    expect(await applyReportViewer(plan, { commandRunner: { run: jest.fn() }, approved: true })).toMatchObject({ state: 'preview' });
    const run = jest.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    expect(await applyReportViewer(plan, { commandRunner: { run }, approved: true, dryRun: false })).toMatchObject({ state: 'applied', applied: true });
    expect(run).toHaveBeenCalledWith('xdg-open', ['/tmp/report.html'], expect.any(Object));
    expect(await applyReportViewer(plan, { commandRunner: { run: jest.fn().mockResolvedValue({ code: 1, stderr: 'denied' }) }, approved: true, dryRun: false })).toMatchObject({ state: 'rejected', reason: 'denied' });
    expect(await applyReportViewer(plan, { commandRunner: { run: jest.fn().mockResolvedValue({ code: 1 }) }, approved: true, dryRun: false })).toMatchObject({ state: 'rejected', reason: 'report opener failed' });
    expect(await applyReportViewer(plan, { commandRunner: { run: jest.fn().mockRejectedValue(new Error('failed')) }, approved: true, dryRun: false })).toMatchObject({ state: 'rejected', reason: 'failed' });
    await expect(applyReportViewer(null, { commandRunner: { run: jest.fn() } })).rejects.toThrow('invalid');
  });
});
