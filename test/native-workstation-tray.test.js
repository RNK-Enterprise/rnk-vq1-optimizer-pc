/**
 * Native workstation tray tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { applyWorkstationTray, buildWorkstationTrayPlan, WORKSTATION_TRAY_VERSION } from '../native/workstation-tray.js';

describe('workstation tray authority', () => {
  const base = { historyPath: '/tmp/history.jsonl', reportPath: '/tmp/dashboard.html', cliPath: '/app/native/cli.mjs', nodePath: '/usr/bin/node' };

  test('builds fixed platform tray plans', () => {
    expect(buildWorkstationTrayPlan({ ...base, platform: 'win32' })).toMatchObject({ version: WORKSTATION_TRAY_VERSION, state: 'review-ready', commands: [{ file: '/usr/bin/node' }, { file: 'powershell.exe' } ] });
    const windows = buildWorkstationTrayPlan({ ...base, platform: 'win32', nodePath: 'C:\\node\\node.exe', historyPath: 'C:\\data\\history.jsonl', reportPath: "C:\\data\\odinn's.html", cliPath: 'C:\\app\\cli.mjs', pathImpl: { isAbsolute: (value) => /^[A-Z]:\\/.test(value), resolve: (value) => value } });
    expect(windows).toMatchObject({ state: 'review-ready', commands: [{ file: 'C:\\node\\node.exe' }, { file: 'powershell.exe' } ] });
    expect(buildWorkstationTrayPlan({ ...base, platform: 'linux', reportPath: "/tmp/odinn's.html" })).toMatchObject({ state: 'review-ready', commands: [{ file: '/usr/bin/node' }, { file: 'yad' } ] });
    expect(buildWorkstationTrayPlan({ ...base, platform: 'darwin' })).toMatchObject({ state: 'review-ready', commands: [{ file: '/usr/bin/node' }, { file: 'osascript' }] });
    expect(buildWorkstationTrayPlan({ ...base, platform: 'freebsd' })).toMatchObject({ state: 'unsupported-platform' });
    expect(buildWorkstationTrayPlan({ ...base, platform: null })).toMatchObject({ state: 'unsupported-platform', platform: 'unknown' });
    expect(buildWorkstationTrayPlan()).toMatchObject({ state: 'invalid-input' });
    expect(buildWorkstationTrayPlan({ ...base, historyPath: 'relative' })).toMatchObject({ state: 'invalid-input' });
    expect(buildWorkstationTrayPlan({ ...base, reportPath: '/tmp/dashboard.txt' })).toMatchObject({ state: 'invalid-input', reason: expect.stringContaining('HTML') });
  });

  test('requires approval and verifies both snapshot and tray stages', async () => {
    const plan = buildWorkstationTrayPlan({ ...base, platform: 'linux' });
    const run = jest.fn(async () => ({ code: 0 }));
    await expect(applyWorkstationTray({})).resolves.toMatchObject({ state: 'refused' });
    await expect(applyWorkstationTray(plan)).resolves.toMatchObject({ state: 'approval-required' });
    await expect(applyWorkstationTray(plan, { approved: true, dryRun: true })).resolves.toMatchObject({ state: 'preview' });
    await expect(applyWorkstationTray(plan, { approved: true, dryRun: false })).rejects.toThrow('command runner');
    await expect(applyWorkstationTray(plan, { approved: true, dryRun: false, commandRunner: { run } })).resolves.toMatchObject({ state: 'applied', reportPath: '/tmp/dashboard.html' });
    expect(run).toHaveBeenCalledTimes(2);
    await expect(applyWorkstationTray(plan, { approved: true, dryRun: false, commandRunner: { run: jest.fn(async () => ({ code: 1, stderr: 'snapshot' })) } })).resolves.toMatchObject({ state: 'rejected', stage: 'snapshot' });
    await expect(applyWorkstationTray(plan, { approved: true, dryRun: false, commandRunner: { run: jest.fn(async () => ({ code: 1 })) } })).resolves.toMatchObject({ state: 'rejected', stage: 'snapshot', reason: 'tray snapshot failed' });
    await expect(applyWorkstationTray(plan, { approved: true, dryRun: false, commandRunner: { run: jest.fn().mockResolvedValueOnce({ code: 0 }).mockResolvedValueOnce({ code: 1, stderr: 'tray' }) } })).resolves.toMatchObject({ state: 'rejected', stage: 'tray' });
    await expect(applyWorkstationTray(plan, { approved: true, dryRun: false, commandRunner: { run: jest.fn().mockResolvedValueOnce({ code: 0 }).mockResolvedValueOnce({ code: 1 }) } })).resolves.toMatchObject({ state: 'rejected', stage: 'tray', reason: 'tray host failed' });
    await expect(applyWorkstationTray(plan, { approved: true, dryRun: false, commandRunner: { run: jest.fn().mockResolvedValueOnce({ code: 0 }).mockRejectedValueOnce(new Error('host unavailable')) } })).resolves.toMatchObject({ state: 'rejected', stage: 'tray', reason: 'host unavailable' });
  });
});
