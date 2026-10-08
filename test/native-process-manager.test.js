/**
 * Native process manager tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { applyProcessStop, buildProcessOverview, explainProcess, previewProcessStop, PROCESS_MANAGER_VERSION } from '../native/process-manager.js';

const facts = {
  processes: [
    { pid: 10, name: 'game.exe', role: 'game', foreground: true, memoryBytes: 200 },
    { pid: 20, name: 'builder', role: 'build', memoryBytes: 500, cpuPercent: 40, uptimeSeconds: 9 },
    { pid: 30, name: 'model', role: 'model', protected: true, memoryBytes: 800 }
  ],
  startup: { entries: [{ name: 'Editor', location: 'user', command: 'editor', enabled: true }, { name: '', enabled: false }] }
};

describe('native process manager', () => {
  test('explains process identity, usage, and protected stop boundaries', () => {
    expect(explainProcess(facts.processes[1])).toMatchObject({ version: PROCESS_MANAGER_VERSION, pid: 20, role: 'build', usage: { cpuPercent: 40, memoryBytes: 500 }, runtime: 9, stop: { state: 'review-ready', operation: 'stop-approved-process' } });
    expect(explainProcess(facts.processes[0]).stop).toMatchObject({ state: 'refused', reason: 'foreground process is not stoppable by this plan' });
    expect(explainProcess(facts.processes[2]).stop).toMatchObject({ state: 'refused', reason: 'process is protected' });
    expect(explainProcess({ pid: 1, name: 'shell', role: 'shell' }).stop.reason).toContain('protected by policy');
    expect(explainProcess({ pid: 2, name: 'helper', role: 'helper' }, { protectedNames: ['helper'] }).stop.reason).toContain('name is protected');
    expect(explainProcess({ pid: 3, name: 'plain', role: 'helper' }, { protectedNames: 'not-a-list' }).stop.state).toBe('review-ready');
    expect(explainProcess({ pid: 0, name: '', role: '', cpuPercent: 'bad', memoryBytes: -1, uptimeSeconds: 'bad' })).toMatchObject({ pid: null, name: 'unknown', role: 'unknown', usage: { cpuPercent: null, memoryBytes: null }, runtime: null });
    expect(() => explainProcess()).toThrow('process record');
  });

  test('builds bounded process and startup overview and exact stop previews', () => {
    const overview = buildProcessOverview(facts, { protectedNames: ['editor'], maxEntries: 2 });
    expect(overview).toMatchObject({ version: PROCESS_MANAGER_VERSION, processCount: 2, startupCount: 2, mutation: 'none' });
    expect(overview.processes[0].name).toBe('model');
    expect(overview.startup[1]).toMatchObject({ name: 'unnamed-startup', enabled: false, authority: 'review-only', change: 'preview-only' });
    expect(previewProcessStop(facts, 20)).toMatchObject({ state: 'plan-ready', pid: 20, reason: null, mutation: 'none' });
    expect(previewProcessStop(facts, 10)).toMatchObject({ state: 'refused', reason: 'foreground process is not stoppable by this plan' });
    expect(previewProcessStop(facts, 999)).toMatchObject({ state: 'refused', pid: 999, reason: 'process was not observed' });
    expect(previewProcessStop(facts, '20')).toMatchObject({ state: 'refused', pid: null });
    expect(buildProcessOverview({})).toMatchObject({ processCount: 0, startupCount: 0 });
    expect(buildProcessOverview()).toMatchObject({ processCount: 0, startupCount: 0 });
    expect(buildProcessOverview({ processes: [{ pid: 1, name: '', role: '' }, { pid: 2, name: 'b', memoryBytes: 1 }, { pid: 3, name: 'c' }, { pid: 4, name: 'd', memoryBytes: 2 }] })).toMatchObject({ processCount: 4 });
    expect(() => buildProcessOverview(null)).toThrow('facts');
    expect(() => buildProcessOverview(facts, { maxEntries: 0 })).toThrow('maxEntries');
    expect(() => previewProcessStop(null, 1)).toThrow('facts');
  });

  test('applies only approved review-ready plans and reports authority boundaries', async () => {
    const adapter = { requiresAdmin: () => true, applyAction: jest.fn(async () => ({ ok: true })) };
    const plan = previewProcessStop(facts, 20);
    await expect(applyProcessStop(plan, { adapter })).resolves.toMatchObject({ state: 'approval-required' });
    await expect(applyProcessStop(plan, { adapter, approved: true })).resolves.toMatchObject({ state: 'preview' });
    await expect(applyProcessStop(plan, { adapter, approved: true, allowAdmin: false, dryRun: false })).resolves.toMatchObject({ state: 'admin-required' });
    await expect(applyProcessStop(plan, { adapter, approved: true, allowAdmin: true, dryRun: false })).resolves.toMatchObject({ state: 'applied', applied: true });
    expect(adapter.applyAction).toHaveBeenCalledWith({ type: 'stop-approved-process' }, expect.objectContaining({ targetPid: 20, approvedBackgroundPids: [20] }));
    const rejecting = { applyAction: jest.fn(async () => ({ ok: false })) };
    await expect(applyProcessStop(plan, { adapter: rejecting, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'adapter rejected process stop' });
    await expect(applyProcessStop(plan, { adapter: { applyAction: jest.fn(async () => { throw new Error('nope'); }) }, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'nope' });
    await expect(applyProcessStop(previewProcessStop(facts, 10), { adapter, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'refused', applied: false });
    await expect(applyProcessStop()).rejects.toThrow('plan');
    await expect(applyProcessStop(plan, { adapter: null, approved: true })).rejects.toThrow('adapter');
    await expect(applyProcessStop({ version: 1, operation: 'other' }, { adapter })).rejects.toThrow('plan');
  });
});
