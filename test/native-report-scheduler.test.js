/**
 * Native report scheduler tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { applyReportSchedule, previewReportSchedule, restoreReportSchedule } from '../native/report-scheduler.js';

const commandSuccess = async () => ({ code: 0, stdout: '', stderr: '' });

describe('native report scheduler', () => {
  let root;
  let base;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-report-scheduler-'));
    base = {
      nodePath: path.join(root, 'node'),
      cliPath: path.join(root, 'native', 'cli.mjs'),
      historyPath: path.join(root, 'history.jsonl'),
      outputPath: path.join(root, 'daily report.json'),
      env: { HOME: root, XDG_CONFIG_HOME: path.join(root, '.config') }
    };
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test('builds bounded plans for all supported platforms and refuses others', () => {
    const linux = previewReportSchedule({ ...base, platform: 'linux', time: '07:05' });
    expect(linux.state).toBe('plan-ready');
    expect(linux.authority).toBe('systemd-user');
    expect(linux.details.files.timer).toContain('OnCalendar=*-*-* 07:05:00');
    expect(linux.details.files.service).toContain('ExecStart=');
    expect(linux.details.servicePath).toContain('.service');

    const mac = previewReportSchedule({ ...base, platform: 'darwin', outputPath: path.join(root, 'daily&report.md'), format: 'markdown', taskName: 'RNK-Optimizer-Daily-Report Mac' });
    expect(mac.authority).toBe('launchd-user');
    expect(mac.details.files.plist).toContain('&amp;');
    expect(mac.details.files.plist).toContain('<key>Hour</key><integer>9</integer>');

    const windows = previewReportSchedule({ ...base, platform: 'win32', taskName: 'RNK-Optimizer-Daily-Report Windows' });
    expect(windows.authority).toBe('windows-task-scheduler');
    expect(windows.details.command.file).toBe('powershell.exe');
    expect(windows.details.command.args.some((value) => value.includes('Register-ScheduledTask'))).toBe(true);
    expect(windows.details.command.args.some((value) => value.includes('daily report'))).toBe(true);

    expect(previewReportSchedule({ ...base, platform: 'freebsd' })).toEqual(expect.objectContaining({ state: 'unsupported-platform' }));
    expect(previewReportSchedule({ ...base, platform: '' })).toEqual(expect.objectContaining({ state: 'unsupported-platform', platform: 'unknown' }));
  });

  test('validates paths, names, formats, and time values', () => {
    expect(() => previewReportSchedule({ ...base, historyPath: 'relative.jsonl' })).toThrow('absolute safe path');
    expect(() => previewReportSchedule({ ...base, format: 'xml' })).toThrow('Unsupported report format');
    expect(() => previewReportSchedule({ ...base, time: '24:00' })).toThrow('HH:MM');
    expect(() => previewReportSchedule({ ...base, time: 'bad' })).toThrow('HH:MM');
    expect(() => previewReportSchedule({ ...base, taskName: 'Other-Task' })).toThrow('fixed RNK prefix');
    expect(() => previewReportSchedule({ ...base, outputPath: `${root}\nreport.json` })).toThrow('absolute safe path');
    expect(() => previewReportSchedule()).toThrow('absolute safe path');
    expect(previewReportSchedule({ ...base, platform: 'linux', format: '', time: '', taskName: '' }).format).toBe('json');
    const defaults = previewReportSchedule({ ...base, platform: 'linux', env: {} });
    expect(defaults.details.servicePath).toContain(path.join('.config', 'systemd', 'user'));
  });

  test('applies and restores a Linux user timer with approval and receipts', async () => {
    const plan = previewReportSchedule({ ...base, platform: 'linux' });
    expect(await applyReportSchedule(plan, { approved: false, dryRun: false, commandRunner: { run: commandSuccess } })).toEqual(expect.objectContaining({ state: 'approval-required', applied: false }));
    expect(await applyReportSchedule(plan, { dryRun: true })).toEqual(expect.objectContaining({ state: 'preview', applied: false }));
    expect((await applyReportSchedule(plan)).state).toBe('preview');
    const calls = [];
    const applied = await applyReportSchedule(plan, { approved: true, dryRun: false, commandRunner: { run: async (...args) => { calls.push(args); return commandSuccess(); } } });
    expect(applied.state).toBe('applied');
    expect(calls).toHaveLength(2);
    expect(await fs.readFile(plan.details.timerPath, 'utf8')).toContain('Persistent=true');
    const restored = await restoreReportSchedule(applied.receipt, { approved: true, dryRun: false, commandRunner: { run: commandSuccess } });
    expect(restored).toEqual({ state: 'restored', restored: true });
    await expect(fs.lstat(plan.details.timerPath)).rejects.toThrow();
  });

  test('reports platform-command failures and command exceptions', async () => {
    const plan = previewReportSchedule({ ...base, platform: 'linux' });
    const failed = await applyReportSchedule(plan, { approved: true, dryRun: false, commandRunner: { run: async () => ({ code: 1, stderr: 'denied' }) } });
    expect(failed).toEqual({ state: 'rejected', applied: false, reason: 'denied' });
    await expect(fs.lstat(plan.details.timerPath)).rejects.toThrow();
    const writeFailure = await applyReportSchedule(plan, { approved: true, dryRun: false, fsImpl: { mkdir: async () => { throw new Error('write denied'); }, writeFile: async () => {}, rm: async () => {} }, commandRunner: { run: commandSuccess } });
    expect(writeFailure).toEqual({ state: 'rejected', applied: false, reason: 'write denied' });
    const cleanupFailure = await applyReportSchedule(plan, { approved: true, dryRun: false, fsImpl: { mkdir: async () => {}, writeFile: async () => {}, rm: async () => { throw new Error('cleanup denied'); } }, commandRunner: { run: async () => ({ code: 1, stderr: 'denied' }) } });
    expect(cleanupFailure.reason).toBe('denied; schedule artifact cleanup failed: cleanup denied');
    const noRunner = await applyReportSchedule(previewReportSchedule({ ...base, platform: 'win32' }), { approved: true, dryRun: false });
    expect(noRunner.reason).toContain('authority is unavailable');
    const noStderr = await applyReportSchedule(previewReportSchedule({ ...base, platform: 'win32' }), { approved: true, dryRun: false, commandRunner: { run: async () => ({ code: 1 }) } });
    expect(noStderr.reason).toBe('Windows task registration failed');
    const throwing = await applyReportSchedule(previewReportSchedule({ ...base, platform: 'win32' }), { approved: true, dryRun: false, commandRunner: { run: async () => { throw new Error('spawn failed'); } } });
    expect(throwing).toEqual({ state: 'rejected', applied: false, reason: 'spawn failed' });
  });

  test('applies and restores macOS launchd and Windows task plans', async () => {
    const mac = previewReportSchedule({ ...base, platform: 'darwin' });
    const macCalls = [];
    const macApplied = await applyReportSchedule(mac, { approved: true, dryRun: false, commandRunner: { run: async (...args) => { macCalls.push(args); return commandSuccess(); } } });
    expect(macApplied.state).toBe('applied');
    expect(macCalls[0][0]).toBe('launchctl');
    expect((await restoreReportSchedule(macApplied.receipt, { approved: true, dryRun: false, commandRunner: { run: commandSuccess } })).restored).toBe(true);

    const windows = previewReportSchedule({ ...base, platform: 'win32' });
    const winCalls = [];
    const winApplied = await applyReportSchedule(windows, { approved: true, dryRun: false, commandRunner: { run: async (...args) => { winCalls.push(args); return commandSuccess(); } } });
    expect(winApplied.state).toBe('applied');
    expect(winCalls[0][0]).toBe('powershell.exe');
    const winRestored = await restoreReportSchedule(winApplied.receipt, { approved: true, dryRun: false, commandRunner: { run: commandSuccess } });
    expect(winRestored).toEqual({ state: 'restored', restored: true });
    const fallbackWindows = await restoreReportSchedule({ ...winApplied.receipt, details: {} }, { approved: true, dryRun: false, commandRunner: { run: commandSuccess } });
    expect(fallbackWindows).toEqual({ state: 'restored', restored: true });
  });

  test('covers restore safety failures and invalid receipts', async () => {
    const plan = previewReportSchedule({ ...base, platform: 'darwin' });
    await expect(applyReportSchedule(null)).rejects.toThrow('plan is invalid');
    await expect(applyReportSchedule({ version: 1, state: 'plan-ready', operation: 'install-daily-report-schedule', platform: 'linux' })).rejects.toThrow('plan fields are invalid');
    const applied = await applyReportSchedule(plan, { approved: true, dryRun: false, commandRunner: { run: commandSuccess } });
    expect(await restoreReportSchedule(applied.receipt, { approved: false, dryRun: false, commandRunner: { run: commandSuccess } })).toEqual(expect.objectContaining({ state: 'approval-required', restored: false }));
    expect(await restoreReportSchedule(applied.receipt, { dryRun: true })).toEqual(expect.objectContaining({ state: 'preview', restored: false }));
    const failedRemoval = await restoreReportSchedule(applied.receipt, { approved: true, dryRun: false, commandRunner: { run: async () => ({ code: 1, stderr: 'busy' }) } });
    expect(failedRemoval).toEqual({ state: 'rejected', restored: false, reason: 'busy' });
    const throwingRemoval = await restoreReportSchedule(applied.receipt, { approved: true, dryRun: false, commandRunner: { run: async () => { throw new Error('gone'); } } });
    expect(throwingRemoval).toEqual({ state: 'rejected', restored: false, reason: 'gone' });
    await expect(restoreReportSchedule(null)).rejects.toThrow('receipt is invalid');
    await expect(restoreReportSchedule({ version: 1, action: 'bad' })).rejects.toThrow('receipt is invalid');
    const unsupported = await restoreReportSchedule({ version: 1, action: 'remove-daily-report-schedule', platform: 'freebsd', taskName: 'RNK-Optimizer-Daily-Report', details: {} }, { approved: true, dryRun: false });
    expect(unsupported).toEqual({ state: 'rejected', restored: false, reason: 'unsupported report schedule platform: freebsd' });
    const fsFailure = await restoreReportSchedule(applied.receipt, { approved: true, dryRun: false, commandRunner: { run: commandSuccess }, fsImpl: { rm: async () => { throw new Error('cannot remove'); } } });
    expect(fsFailure).toEqual({ state: 'rejected', restored: false, reason: 'cannot remove' });
  });
});
