/**
 * Native workstation shell tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { applyWorkstationShell, buildWorkstationShellPlan, WORKSTATION_SHELL_VERSION } from '../native/workstation-shell.js';
import { defaultWorkstationPaths, WORKSTATION_PATHS_VERSION } from '../native/workstation-paths.js';
import path from 'path';

describe('workstation shell session', () => {
  test('resolves isolated platform user-data paths for packaged sessions', () => {
    expect(defaultWorkstationPaths()).toMatchObject({ version: WORKSTATION_PATHS_VERSION, state: 'ready' });
    expect(defaultWorkstationPaths({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\Odinn\\AppData\\Local' } })).toMatchObject({ state: 'ready', historyPath: 'C:\\Users\\Odinn\\AppData\\Local\\RNK\\Optimizer\\history.jsonl' });
    expect(defaultWorkstationPaths({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\Odinn\\AppData\\Local' }, pathImpl: { isAbsolute: (value) => /^[A-Z]:\\/.test(value), join: (...values) => values.join('\\') } })).toMatchObject({ version: WORKSTATION_PATHS_VERSION, state: 'ready', historyPath: 'C:\\Users\\Odinn\\AppData\\Local\\RNK\\Optimizer\\history.jsonl' });
    expect(defaultWorkstationPaths({ platform: 'win32', env: { APPDATA: 'C:\\Users\\Odinn\\AppData\\Roaming' }, pathImpl: { isAbsolute: (value) => /^[A-Z]:\\/.test(value), join: (...values) => values.join('\\') } })).toMatchObject({ state: 'ready' });
    expect(defaultWorkstationPaths({ platform: 'linux', env: { XDG_STATE_HOME: '/state' } })).toMatchObject({ state: 'ready', root: '/state/RNK/Optimizer' });
    expect(defaultWorkstationPaths({ platform: 'linux', env: { HOME: '/home/odinn' } })).toMatchObject({ state: 'ready', root: '/home/odinn/.local/state/RNK/Optimizer' });
    expect(defaultWorkstationPaths({ platform: 'darwin', env: { HOME: '/Users/odinn' } })).toMatchObject({ state: 'ready', root: '/Users/odinn/Library/Application Support/RNK/Optimizer' });
    expect(defaultWorkstationPaths({ platform: 'freebsd', env: {} })).toMatchObject({ state: 'unsupported-platform' });
    expect(defaultWorkstationPaths({ platform: 'linux', env: {} })).toMatchObject({ state: 'invalid-environment' });
    expect(defaultWorkstationPaths({ platform: 'win32', env: { LOCALAPPDATA: 'relative', APPDATA: 'also-relative' } })).toMatchObject({ state: 'invalid-environment' });
    expect(defaultWorkstationPaths({ platform: null, env: {} })).toMatchObject({ platform: 'unknown', state: 'unsupported-platform' });
  });

  test('builds fixed cross-platform dashboard sessions', () => {
    expect(buildWorkstationShellPlan({ platform: 'linux', historyPath: '/tmp/history.jsonl', reportPath: '/tmp/report.html', cliPath: '/app/native/cli.mjs', nodePath: '/usr/bin/node', pathImpl: path.posix })).toMatchObject({ version: WORKSTATION_SHELL_VERSION, state: 'review-ready', commands: [{ file: '/usr/bin/node' }, { file: 'xdg-open', args: ['/tmp/report.html'] }] });
    expect(buildWorkstationShellPlan({ platform: 'win32', historyPath: 'C:\\data\\history.jsonl', reportPath: 'C:\\data\\report.html', cliPath: 'C:\\app\\native\\cli.mjs', nodePath: 'C:\\node\\node.exe', pathImpl: { isAbsolute: (value) => /^[A-Z]:\\/.test(value) } })).toMatchObject({ state: 'review-ready', commands: [{ file: 'C:\\node\\node.exe' }, { file: 'explorer.exe' }] });
    expect(buildWorkstationShellPlan({ historyPath: 1, reportPath: '/tmp/report.html', cliPath: '/app/cli.mjs', pathImpl: path.posix })).toMatchObject({ state: 'invalid-input' });
  });

  test('refuses invalid or unsupported targets', () => {
    expect(buildWorkstationShellPlan()).toMatchObject({ state: 'invalid-input' });
    expect(buildWorkstationShellPlan({ historyPath: 'relative', reportPath: '/tmp/report.html', cliPath: '/app/cli.mjs', nodePath: '/usr/bin/node', pathImpl: path.posix })).toMatchObject({ state: 'invalid-input' });
    expect(buildWorkstationShellPlan({ historyPath: '/tmp/history', reportPath: '/tmp/report.txt', cliPath: '/app/cli.mjs', nodePath: '/usr/bin/node', pathImpl: path.posix })).toMatchObject({ state: 'invalid-input', reason: expect.stringContaining('HTML') });
    expect(buildWorkstationShellPlan({ platform: 'freebsd', historyPath: '/tmp/history', reportPath: '/tmp/report.html', cliPath: '/app/cli.mjs', nodePath: '/usr/bin/node', pathImpl: path.posix })).toMatchObject({ state: 'unsupported-platform' });
    expect(buildWorkstationShellPlan({ platform: null, historyPath: '/tmp/history', reportPath: '/tmp/report.html', cliPath: '/app/cli.mjs', nodePath: '/usr/bin/node', pathImpl: path.posix })).toMatchObject({ state: 'unsupported-platform', platform: 'unknown' });
  });

  test('applies only approved plans through two fixed commands', async () => {
    const plan = buildWorkstationShellPlan({ platform: 'linux', historyPath: '/tmp/history', reportPath: '/tmp/report.html', cliPath: '/app/cli.mjs', nodePath: '/usr/bin/node', pathImpl: path.posix });
    const run = jest.fn(async () => ({ code: 0 }));
    await expect(applyWorkstationShell(plan)).resolves.toMatchObject({ state: 'refused' });
    await expect(applyWorkstationShell(plan, { approved: true, dryRun: true })).resolves.toMatchObject({ state: 'preview' });
    await expect(applyWorkstationShell(plan, { approved: true, dryRun: false, commandRunner: { run } })).resolves.toMatchObject({ state: 'applied', reportPath: '/tmp/report.html' });
    expect(run).toHaveBeenCalledTimes(2);
    await expect(applyWorkstationShell(plan, { approved: true, dryRun: false, commandRunner: { run: jest.fn(async () => ({ code: 1, stderr: 'snapshot' })) } })).resolves.toMatchObject({ state: 'rejected', stage: 'snapshot' });
    await expect(applyWorkstationShell(plan, { approved: true, dryRun: false, commandRunner: { run: jest.fn().mockResolvedValueOnce({ code: 0 }).mockResolvedValueOnce({ code: 1, stderr: 'open' }) } })).resolves.toMatchObject({ state: 'rejected', stage: 'open' });
    await expect(applyWorkstationShell(plan, { approved: true, dryRun: false, commandRunner: { run: jest.fn(async () => ({ code: 1 })) } })).resolves.toMatchObject({ state: 'rejected', stage: 'snapshot', reason: 'dashboard snapshot failed' });
    await expect(applyWorkstationShell(plan, { approved: true, dryRun: false, commandRunner: { run: jest.fn().mockResolvedValueOnce({ code: 0 }).mockResolvedValueOnce({ code: 1 }) } })).resolves.toMatchObject({ state: 'rejected', stage: 'open', reason: 'dashboard opener failed' });
    await expect(applyWorkstationShell(plan, { approved: true, dryRun: false })).rejects.toThrow('command runner');
    await expect(applyWorkstationShell({})).resolves.toMatchObject({ state: 'refused' });
  });
});
