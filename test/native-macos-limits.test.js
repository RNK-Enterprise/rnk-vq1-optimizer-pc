/**
 * macOS launch-limit tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { applyMacosLaunchLimits, previewMacosHardLimits, previewMacosLaunchLimits, removeMacosLaunchLimits } from '../native/macos-limits.js';

describe('macOS hard resource limits', () => {
  test('refuses attaching hard limits to an existing PID', () => {
    expect(previewMacosHardLimits()).toMatchObject({ state: 'invalid' });
    expect(previewMacosHardLimits({ targetPid: 42, cpuSeconds: 60, memoryBytes: 64 * 1024 ** 2 })).toMatchObject({ state: 'unsupported-existing-process', targetPid: 42 });
    expect(previewMacosHardLimits({ targetPid: 0, cpuSeconds: 60 })).toMatchObject({ state: 'invalid' });
    expect(previewMacosHardLimits({ targetPid: 42 })).toMatchObject({ state: 'invalid' });
  });

  test('builds a bounded launchd plan with XML escaping', () => {
    expect(previewMacosLaunchLimits()).toMatchObject({ state: 'invalid' });
    const plan = previewMacosLaunchLimits({ label: 'rnk.test', executable: '/Applications/Game.app/Contents/MacOS/Game', args: ['--name', 'A&B'], cpuSeconds: 60, memoryBytes: 64 * 1024 ** 2 });
    expect(plan).toMatchObject({ state: 'plan-ready', label: 'rnk.test', cpuSeconds: 60, memoryBytes: 64 * 1024 ** 2 });
    expect(plan.plist).toContain('A&amp;B');
    expect(previewMacosLaunchLimits({ label: 'bad label', executable: '/bin/game', cpuSeconds: 1 })).toMatchObject({ state: 'invalid' });
    expect(previewMacosLaunchLimits({ label: 'valid', executable: 'game', cpuSeconds: 1 })).toMatchObject({ state: 'invalid' });
    expect(previewMacosLaunchLimits({ label: 'valid', executable: '', cpuSeconds: 1 })).toMatchObject({ state: 'invalid' });
    expect(previewMacosLaunchLimits({ label: 'valid', executable: '/bin/game', args: [1], cpuSeconds: 1 })).toMatchObject({ state: 'invalid' });
    expect(previewMacosLaunchLimits({ label: 'valid', executable: '/bin/game', cpuSeconds: 0, memoryBytes: 1 })).toMatchObject({ state: 'invalid' });
    expect(previewMacosLaunchLimits({ label: 'cpu-only', executable: '/bin/game', cpuSeconds: 1 })).toMatchObject({ state: 'plan-ready', memoryBytes: null });
  });

  test('applies and removes launchd jobs only with explicit approval', async () => {
    const plan = previewMacosLaunchLimits({ label: 'rnk.test', executable: '/bin/game', memoryBytes: 64 * 1024 ** 2 });
    await expect(applyMacosLaunchLimits(plan)).resolves.toMatchObject({ state: 'approval-required', applied: false });
    await expect(applyMacosLaunchLimits(plan, { approved: true, dryRun: true })).resolves.toMatchObject({ state: 'preview', applied: false });
    await expect(applyMacosLaunchLimits(plan, { approved: true, dryRun: false })).resolves.toMatchObject({ state: 'unavailable', applied: false });
    const fsImpl = { mkdir: jest.fn(async () => {}), writeFile: jest.fn(async () => {}) };
    const pathImpl = { join: jest.fn((...parts) => parts.join('/')) };
    const runner = { run: jest.fn(async () => ({ code: 0 })) };
    await expect(applyMacosLaunchLimits(plan, { commandRunner: runner, fsImpl, pathImpl, approved: true, dryRun: false, stateRoot: '/state', userId: '501' })).resolves.toMatchObject({ state: 'applied', applied: true });
    expect(fsImpl.writeFile).toHaveBeenCalledWith('/state/rnk-optimizer-launch/rnk.test.plist', plan.plist, 'utf8');
    expect(runner.run).toHaveBeenCalledWith('launchctl', ['bootstrap', 'gui/501', '/state/rnk-optimizer-launch/rnk.test.plist'], expect.any(Object));
    runner.run.mockResolvedValueOnce({ code: 1, stderr: 'denied' });
    await expect(applyMacosLaunchLimits(plan, { commandRunner: runner, fsImpl, pathImpl, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'denied' });
    runner.run.mockRejectedValueOnce(new Error('write failed'));
    await expect(applyMacosLaunchLimits(plan, { commandRunner: runner, fsImpl, pathImpl, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'write failed' });
    await expect(applyMacosLaunchLimits(plan, { commandRunner: runner, fsImpl: {}, pathImpl, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'unavailable' });
    await expect(applyMacosLaunchLimits({ state: 'bad' }, { approved: true, dryRun: false })).rejects.toThrow('plan');
    runner.run.mockResolvedValueOnce({ code: 1 });
    await expect(applyMacosLaunchLimits(plan, { commandRunner: runner, fsImpl, pathImpl, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'launchctl applied failed' });
  });

  test('removes launchd jobs through fixed bootout', async () => {
    await expect(removeMacosLaunchLimits('bad label')).rejects.toThrow('invalid');
    await expect(removeMacosLaunchLimits('rnk.test')).resolves.toMatchObject({ state: 'approval-required', removed: false });
    await expect(removeMacosLaunchLimits('rnk.test', { approved: true, dryRun: true })).resolves.toMatchObject({ state: 'preview', removed: false });
    await expect(removeMacosLaunchLimits('rnk.test', { approved: true, dryRun: false })).resolves.toMatchObject({ state: 'unavailable' });
    const runner = { run: jest.fn(async () => ({ code: 0 })) };
    await expect(removeMacosLaunchLimits('rnk.test', { commandRunner: runner, approved: true, dryRun: false, userId: '501' })).resolves.toMatchObject({ state: 'removed', removed: true });
    runner.run.mockResolvedValueOnce({ code: 1 });
    await expect(removeMacosLaunchLimits('rnk.test', { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'launchctl removal failed' });
    runner.run.mockRejectedValueOnce(new Error('bootout failed'));
    await expect(removeMacosLaunchLimits('rnk.test', { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'bootout failed' });
  });
});
