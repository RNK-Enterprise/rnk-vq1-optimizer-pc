/**
 * Native startup mutation tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import path from 'path';
import { applyStartupMutation, previewStartupMutation, restoreStartupMutation, STARTUP_MANAGER_VERSION } from '../native/startup-manager.js';

const linuxLocation = '/home/test/.config/autostart/up.desktop';
const linuxFacts = { platform: 'linux', startup: { entries: [{ name: 'Updater', location: linuxLocation, command: 'up.exe', enabled: true }, { name: 'Disabled', location: '/home/test/.config/autostart/off.desktop', enabled: false }, { name: 'Protected', location: '/home/test/.config/autostart/protected.desktop', enabled: true }] } };
const windowsLocation = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const windowsFacts = { platform: 'win32', startup: { entries: [{ name: 'Updater', location: windowsLocation, command: 'up.exe', enabled: true }] } };

function regularFs({ destination = 'missing', source = 'file', rename = async () => {} } = {}) {
  return {
    lstat: jest.fn(async (file) => {
      if (file.endsWith('.rnk-disabled')) {
        if (destination === 'missing') throw { code: 'ENOENT' };
        if (destination === 'error') throw new Error('destination denied');
        return { isFile: () => true, isSymbolicLink: () => false };
      }
      if (source === 'error') throw new Error('source denied');
      if (source === 'symlink') return { isFile: () => true, isSymbolicLink: () => true };
      if (source === 'directory') return { isFile: () => false, isSymbolicLink: () => false };
      return { isFile: () => true, isSymbolicLink: () => false };
    }),
    rename
  };
}

describe('native startup manager', () => {
  test('builds exact-entry plans and refuses uncertain entries', async () => {
    expect(() => previewStartupMutation(null)).toThrow('facts');
    expect(previewStartupMutation({ startup: null }, { name: 'Updater', location: linuxLocation })).toMatchObject({ state: 'refused', reason: 'startup entry was not observed' });
    expect(previewStartupMutation(linuxFacts, { name: '', location: linuxLocation })).toMatchObject({ state: 'refused', reason: 'exact startup name and location are required' });
    expect(previewStartupMutation(linuxFacts, { name: 'Bad/name', location: linuxLocation })).toMatchObject({ state: 'refused', reason: 'exact startup name and location are required' });
    expect(previewStartupMutation(linuxFacts, { name: 'Missing', location: linuxLocation })).toMatchObject({ state: 'refused', reason: 'startup entry was not observed' });
    expect(previewStartupMutation(linuxFacts, { name: 'Protected', location: '/home/test/.config/autostart/protected.desktop', protectedNames: ['Bad/name', 'protected'] })).toMatchObject({ version: STARTUP_MANAGER_VERSION, state: 'refused', reason: 'startup entry is protected' });
    expect(previewStartupMutation(linuxFacts, { name: 'Disabled', location: '/home/test/.config/autostart/off.desktop' })).toMatchObject({ state: 'refused', reason: 'startup entry is already disabled' });
    expect(previewStartupMutation(linuxFacts, { name: 'Updater', location: linuxLocation })).toMatchObject({ state: 'plan-ready', operation: 'disable-startup-entry', platform: 'linux', entry: { command: 'up.exe' }, reversible: true });
    expect(previewStartupMutation({ platform: 'unknown', startup: { entries: [{ name: 'Other', location: '/tmp/other.desktop' }] } }, { name: 'Other', location: '/tmp/other.desktop', protectedNames: 'not-a-list' })).toMatchObject({ platform: 'unknown', state: 'plan-ready' });
    const darwinPlan = previewStartupMutation({ platform: 'darwin', startup: { entries: [{ name: 'Agent', location: '/home/test/Library/LaunchAgents/agent.plist', command: 'agent' }] } }, { name: 'Agent', location: '/home/test/Library/LaunchAgents/agent.plist' });
    expect(darwinPlan).toMatchObject({ state: 'plan-ready', platform: 'darwin' });
    await expect(applyStartupMutation(darwinPlan, { approved: true, dryRun: false, fsImpl: regularFs(), env: {} })).resolves.toMatchObject({ state: 'rejected', reason: 'startup path is outside the fixed platform roots' });
    const unknownPlan = previewStartupMutation({ platform: 'freebsd', startup: { entries: [{ name: 'Other', location: '/tmp/other.desktop' }] } }, { name: 'Other', location: '/tmp/other.desktop' });
    expect(unknownPlan).toMatchObject({ state: 'plan-ready', platform: 'freebsd' });
    expect(previewStartupMutation({ startup: { entries: [{ name: 'NoCommand', location: '/tmp/no-command.desktop' }] } }, { name: 'NoCommand', location: '/tmp/no-command.desktop' })).toMatchObject({ state: 'plan-ready', platform: 'unknown', entry: { command: null } });
    await expect(applyStartupMutation(null)).rejects.toThrow('invalid');
    await expect(applyStartupMutation({ ...unknownPlan, entry: { name: 'bad/name', location: '/tmp/other.desktop' } })).rejects.toThrow('entry is invalid');
  });

  test('disables and restores a bounded POSIX startup file', async () => {
    const plan = previewStartupMutation(linuxFacts, { name: 'Updater', location: linuxLocation });
    const rename = jest.fn(async () => {});
    const fsImpl = regularFs({ rename });
    expect(await applyStartupMutation(plan, { dryRun: true })).toMatchObject({ state: 'preview', applied: false });
    await expect(applyStartupMutation(plan, { approved: false, dryRun: false })).resolves.toMatchObject({ state: 'approval-required' });
    const applied = await applyStartupMutation(plan, { approved: true, dryRun: false, fsImpl, env: { HOME: '/home/test' } });
    expect(applied).toMatchObject({ state: 'applied', applied: true, receipt: { action: 'restore-startup-entry', source: path.resolve(linuxLocation) } });
    expect(rename).toHaveBeenCalledWith(path.resolve(linuxLocation), `${path.resolve(linuxLocation)}.rnk-disabled`);
    const restoreFs = { lstat: jest.fn(async () => { throw { code: 'ENOENT' }; }), rename: jest.fn(async () => {}) };
    expect(await restoreStartupMutation(applied.receipt, { approved: true, dryRun: false, fsImpl: restoreFs })).toMatchObject({ state: 'restored', restored: true });
    expect(restoreFs.rename).toHaveBeenCalledWith(applied.receipt.destination, applied.receipt.source);
    await expect(restoreStartupMutation(applied.receipt, { approved: false, dryRun: false })).resolves.toMatchObject({ state: 'approval-required' });
    expect(await restoreStartupMutation(applied.receipt, { dryRun: true })).toMatchObject({ state: 'preview', restored: false });
    const darwinPlan = previewStartupMutation({ platform: 'darwin', startup: { entries: [{ name: 'Agent', location: '/home/test/Library/LaunchAgents/agent.plist', command: 'agent' }] } }, { name: 'Agent', location: '/home/test/Library/LaunchAgents/agent.plist' });
    expect(await applyStartupMutation(darwinPlan, { approved: true, dryRun: false, fsImpl: regularFs(), env: { HOME: '/home/test' } })).toMatchObject({ state: 'applied' });
  });

  test('refuses unsafe POSIX paths and filesystem conditions', async () => {
    const unsupported = previewStartupMutation({ platform: 'freebsd', startup: { entries: [{ name: 'Other', location: '/tmp/other.desktop' }] } }, { name: 'Other', location: '/tmp/other.desktop' });
    await expect(applyStartupMutation(unsupported, { approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'unsupported startup platform: freebsd' });
    const outside = previewStartupMutation({ platform: 'linux', startup: { entries: [{ name: 'Other', location: '/tmp/other.desktop' }] } }, { name: 'Other', location: '/tmp/other.desktop' });
    await expect(applyStartupMutation(outside, { approved: true, dryRun: false, fsImpl: regularFs(), env: { HOME: '/home/test' } })).resolves.toMatchObject({ state: 'rejected', reason: 'startup path is outside the fixed platform roots' });
    const system = previewStartupMutation({ platform: 'linux', startup: { entries: [{ name: 'System', location: '/etc/xdg/autostart/system.desktop', command: 'system' }] } }, { name: 'System', location: '/etc/xdg/autostart/system.desktop' });
    await expect(applyStartupMutation(system, { approved: true, dryRun: false, fsImpl: regularFs(), env: { HOME: '/home/test' } })).resolves.toMatchObject({ state: 'admin-required' });
    expect((await applyStartupMutation(system, { approved: true, allowAdmin: true, dryRun: false, fsImpl: regularFs(), env: { HOME: '/home/test' } })).state).toBe('applied');
    await expect(applyStartupMutation(system, { approved: true, allowAdmin: true, dryRun: false, fsImpl: regularFs({ source: 'symlink' }), env: { HOME: '/home/test' } })).resolves.toMatchObject({ state: 'rejected', reason: 'startup entry must be a regular non-symlink file' });
    await expect(applyStartupMutation(system, { approved: true, allowAdmin: true, dryRun: false, fsImpl: regularFs({ source: 'directory' }), env: { HOME: '/home/test' } })).resolves.toMatchObject({ state: 'rejected', reason: 'startup entry must be a regular non-symlink file' });
    await expect(applyStartupMutation(system, { approved: true, allowAdmin: true, dryRun: false, fsImpl: regularFs({ source: 'error' }), env: { HOME: '/home/test' } })).resolves.toMatchObject({ state: 'rejected', reason: 'source denied' });
    await expect(applyStartupMutation(system, { approved: true, allowAdmin: true, dryRun: false, fsImpl: regularFs(), env: {} })).resolves.toMatchObject({ state: 'applied' });
    await expect(applyStartupMutation(system, { approved: true, allowAdmin: true, dryRun: false, fsImpl: regularFs({ destination: 'exists' }), env: { HOME: '/home/test' } })).resolves.toMatchObject({ state: 'rejected', reason: 'startup disabled destination already exists' });
    await expect(applyStartupMutation(system, { approved: true, allowAdmin: true, dryRun: false, fsImpl: regularFs({ destination: 'error' }), env: { HOME: '/home/test' } })).resolves.toMatchObject({ state: 'rejected', reason: 'destination denied' });
    const renameError = regularFs({ rename: async () => { throw new Error('rename denied'); } });
    await expect(applyStartupMutation(system, { approved: true, allowAdmin: true, dryRun: false, fsImpl: renameError, env: { HOME: '/home/test' } })).resolves.toMatchObject({ state: 'rejected', reason: 'rename denied' });
  });

  test('uses only allow-listed Windows Run registry locations', async () => {
    const plan = previewStartupMutation(windowsFacts, { name: 'Updater', location: windowsLocation });
    const commandRunner = { run: jest.fn(async () => ({ code: 0 })) };
    const applied = await applyStartupMutation(plan, { approved: true, allowAdmin: true, dryRun: false, commandRunner });
    expect(applied).toMatchObject({ state: 'applied', receipt: { registryPath: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', name: 'Updater' } });
    expect(commandRunner.run).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['Remove-ItemProperty -Path $args[0] -Name $args[1] -ErrorAction Stop', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'Updater']));
    expect(await restoreStartupMutation(applied.receipt, { approved: true, commandRunner, dryRun: false })).toMatchObject({ state: 'restored', restored: true });
    const badLocation = previewStartupMutation({ ...windowsFacts, startup: { entries: [{ name: 'Updater', location: 'HKCU\\Software\\Bad', command: 'up.exe' }] } }, { name: 'Updater', location: 'HKCU\\Software\\Bad' });
    await expect(applyStartupMutation(badLocation, { approved: true, dryRun: false, commandRunner })).resolves.toMatchObject({ state: 'rejected', reason: 'Windows startup registry authority is unavailable' });
    await expect(applyStartupMutation(plan, { approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'Windows startup registry authority is unavailable' });
    const tooLarge = previewStartupMutation({ ...windowsFacts, startup: { entries: [{ name: 'Updater', location: windowsLocation, command: 'x'.repeat(8193) }] } }, { name: 'Updater', location: windowsLocation });
    await expect(applyStartupMutation(tooLarge, { approved: true, dryRun: false, commandRunner })).resolves.toMatchObject({ state: 'rejected', reason: 'startup command evidence is unavailable or too large' });
    const denied = { run: jest.fn(async () => ({ code: 1, stderr: 'denied' })) };
    await expect(applyStartupMutation(plan, { approved: true, dryRun: false, commandRunner: denied })).resolves.toMatchObject({ state: 'rejected', reason: 'denied' });
    await expect(applyStartupMutation(plan, { approved: true, dryRun: false, commandRunner: { run: jest.fn(async () => ({ code: 1 })) } })).resolves.toMatchObject({ state: 'rejected', reason: 'disable-startup-entry failed' });
    await expect(applyStartupMutation(plan, { approved: true, dryRun: false, commandRunner: { run: jest.fn(async () => { throw new Error('runner missing'); }) } })).resolves.toMatchObject({ state: 'rejected', reason: 'runner missing' });
    const hklm = previewStartupMutation({ platform: 'win32', startup: { entries: [{ name: 'System', location: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', command: 'system' }] } }, { name: 'System', location: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' });
    await expect(applyStartupMutation(hklm, { approved: true, dryRun: false, commandRunner })).resolves.toMatchObject({ state: 'admin-required' });
  });

  test('restores with bounded receipts and fails closed', async () => {
    await expect(restoreStartupMutation(null)).rejects.toThrow('invalid');
    const winReceipt = { version: STARTUP_MANAGER_VERSION, action: 'restore-startup-entry', platform: 'win32', registryPath: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', name: 'Updater', command: 'up.exe' };
    const fail = { run: jest.fn(async () => ({ code: 1, stderr: 'restore denied' })) };
    await expect(restoreStartupMutation(winReceipt, { approved: true, dryRun: false, commandRunner: fail })).resolves.toMatchObject({ state: 'rejected', reason: 'restore denied' });
    await expect(restoreStartupMutation(winReceipt, { approved: true, dryRun: false, commandRunner: { run: jest.fn(async () => ({ code: 1 })) } })).resolves.toMatchObject({ state: 'rejected', reason: 'restore-startup-entry failed' });
    await expect(restoreStartupMutation(winReceipt, { approved: true, dryRun: false, commandRunner: { run: jest.fn(async () => { throw new Error('restore runner'); }) } })).resolves.toMatchObject({ state: 'rejected', reason: 'restore runner' });
    await expect(restoreStartupMutation(winReceipt, { approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'Windows startup registry authority is unavailable' });
    const hklm = { ...winReceipt, registryPath: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' };
    await expect(restoreStartupMutation(hklm, { approved: true, dryRun: false, commandRunner: { run: jest.fn() } })).resolves.toMatchObject({ state: 'admin-required' });
    const unknown = { version: STARTUP_MANAGER_VERSION, action: 'restore-startup-entry', platform: 'freebsd', source: '/tmp/a', destination: '/tmp/b' };
    await expect(restoreStartupMutation(unknown, { approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'unsupported startup platform: freebsd' });
    const receipt = { version: STARTUP_MANAGER_VERSION, action: 'restore-startup-entry', platform: 'linux', source: '/home/test/.config/autostart/up.desktop', destination: '/home/test/.config/autostart/up.desktop.rnk-disabled' };
    await expect(restoreStartupMutation(receipt, { approved: true, dryRun: false, fsImpl: { lstat: jest.fn(async () => ({})), rename: jest.fn() } })).resolves.toMatchObject({ state: 'rejected', reason: 'original startup path is already occupied' });
    await expect(restoreStartupMutation(receipt, { approved: true, dryRun: false, fsImpl: { lstat: jest.fn(async () => { throw { code: 'EACCES' }; }), rename: jest.fn() } })).resolves.toMatchObject({ state: 'rejected', reason: 'EACCES' });
    await expect(restoreStartupMutation(receipt, { approved: true, dryRun: false, fsImpl: { lstat: jest.fn(async () => { throw {}; }), rename: jest.fn() } })).resolves.toMatchObject({ state: 'rejected', reason: 'startup restore failed' });
    await expect(restoreStartupMutation(receipt, { approved: true, dryRun: false, fsImpl: { lstat: jest.fn(async () => { throw { code: 'ENOENT' }; }), rename: jest.fn(async () => { throw new Error('restore rename'); }) } })).resolves.toMatchObject({ state: 'rejected', reason: 'restore rename' });
    await expect(restoreStartupMutation(receipt, { approved: true, dryRun: false, fsImpl: { lstat: jest.fn(async () => { throw { code: 'ENOENT' }; }), rename: jest.fn(async () => {}) } })).resolves.toMatchObject({ state: 'restored', restored: true });
  });
});
