/**
 * Native workload governor tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { applyWorkloadPolicy, previewWorkloadPolicy, WORKLOAD_GOVERNOR_VERSION, WORKLOAD_MODES } from '../native/workload-governor.js';

const facts = {
  game: { detected: true, pid: 10, name: 'Game.exe' },
  resourceBudget: { cpuPercent: 80, memoryBytes: 800, ioBytesPerSecond: 100, gpuPercent: 70 },
  processes: [
    { pid: 10, name: 'Game.exe', foreground: true, role: 'game' },
    { pid: 20, name: 'build', foreground: false, role: 'build' },
    { pid: 30, name: 'model', foreground: false, protected: true, role: 'ai' },
    { pid: 40, name: 'system', foreground: false, role: 'system' }
  ]
};

describe('native workload governor', () => {
  test('builds a bounded gaming coexistence preview and protects excluded processes', () => {
    expect(WORKLOAD_MODES).toEqual(['balanced', 'developer', 'gaming', 'gaming-build']);
    const plan = previewWorkloadPolicy(facts, { mode: 'gaming-build', backgroundPids: [20, 30, 40, 20], processPriority: 'low', ioPriority: 'normal' });
    expect(plan).toMatchObject({ version: WORKLOAD_GOVERNOR_VERSION, state: 'plan-ready', game: { pid: 10, source: 'declared' }, protectedProcessCount: 1, budget: { cpuPercent: 80, gpuPercent: 70 } });
    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0]).toMatchObject({ pid: 20, type: 'set-process-priority', value: 'low', requiresApproval: true });
    expect(plan.operations[1]).toMatchObject({ pid: 20, type: 'set-process-io-priority', value: 'normal' });
    expect(plan.unsupportedBudgetDimensions).toEqual(['cpu-hard-cap', 'memory-hard-cap', 'gpu-hard-cap']);
  });

  test('uses explicit role or name evidence and returns observation-only without a game', () => {
    const byRole = previewWorkloadPolicy({ processes: [{ pid: 1, name: 'unknown', foreground: true, role: 'gaming' }, { pid: 2, name: 'build', role: 'build' }] }, { mode: 'gaming' });
    expect(byRole.game).toMatchObject({ detected: true, source: 'process-role', confidence: 0.8 });
    const byName = previewWorkloadPolicy({ processes: [{ pid: 3, name: 'Game.EXE' }, { pid: 4, name: 'build' }] }, { mode: 'gaming', gameNames: ['game.exe'] });
    expect(byName.game).toMatchObject({ detected: true, source: 'explicit-name', pid: 3 });
    const none = previewWorkloadPolicy({ processes: [{ pid: 5, name: 'build', foreground: false }] }, { mode: 'gaming' });
    expect(none).toMatchObject({ state: 'observation-only', operations: [], budget: { cpuPercent: null } });
    const fallbackEvidence = previewWorkloadPolicy({ processes: [{ pid: 6, name: null }, { pid: 7, role: 'build' }] }, { mode: 'gaming', gameNames: ['game.exe'], backgroundPids: 'not-an-array' });
    expect(fallbackEvidence.game.detected).toBe(false);
    const unnamedBackground = previewWorkloadPolicy({ processes: [{ pid: 8, role: 'game', foreground: true }, { pid: 9, role: 'build' }] }, { mode: 'gaming' });
    expect(unnamedBackground.operations[0].name).toBe('unknown');
    const noProcessFacts = previewWorkloadPolicy({}, { mode: 'developer', gameNames: 'game.exe' });
    expect(noProcessFacts.operations).toEqual([]);
    const balanced = previewWorkloadPolicy(facts, { mode: 'balanced' });
    expect(balanced.operations).toEqual([]);
  });

  test('applies only explicitly approved PIDs and reports adapter boundaries', async () => {
    const calls = [];
    const adapter = { requiresAdmin: (action) => action.type === 'set-process-io-priority', applyAction: jest.fn(async (action, context) => { calls.push({ action, context }); return action.type === 'set-process-priority' ? { ok: true } : { ok: false, reason: 'io unsupported' }; }) };
    const plan = previewWorkloadPolicy(facts, { mode: 'gaming' });
    const skipped = await applyWorkloadPolicy(plan, { adapter, approvedPids: [] });
    expect(skipped.skipped).toHaveLength(2);
    const admin = await applyWorkloadPolicy(plan, { adapter, approvedPids: [20], dryRun: true });
    expect(admin.adminRequired[0].approved).toBe(false);
    expect(admin.wouldApply).toHaveLength(1);
    const applied = await applyWorkloadPolicy(plan, { adapter, approvedPids: [20], allowAdmin: true, dryRun: false });
    expect(applied.applied).toHaveLength(1);
    expect(applied.rejected).toHaveLength(1);
    expect(calls[0].context).toMatchObject({ targetPid: 20, approved: true, allowProcessStop: false });
    const thrown = { ...adapter, applyAction: jest.fn(async () => { throw new Error('adapter failed'); }) };
    await expect(applyWorkloadPolicy(plan, { adapter: thrown, approvedPids: [20], allowAdmin: true, dryRun: false })).resolves.toMatchObject({ rejected: expect.arrayContaining([expect.objectContaining({ reason: 'adapter failed' })]) });
    const noReason = { applyAction: jest.fn(async () => ({ ok: false })) };
    await expect(applyWorkloadPolicy(plan, { adapter: noReason, approvedPids: [20], dryRun: false })).resolves.toMatchObject({ rejected: expect.arrayContaining([expect.objectContaining({ reason: 'adapter rejected workload operation' })]) });
  });

  test('rejects malformed facts, modes, plans, and adapters', async () => {
    expect(() => previewWorkloadPolicy(null)).toThrow('facts');
    expect(() => previewWorkloadPolicy(facts, { mode: 'turbo' })).toThrow('Unsupported workload mode');
    await expect(applyWorkloadPolicy()).rejects.toThrow('platform adapter');
    expect(() => previewWorkloadPolicy(facts, { mode: '' })).toThrow('unknown');
    expect(() => previewWorkloadPolicy(facts, { mode: 'gaming', processPriority: 'realtime' }).operations[0].value).not.toThrow();
    await expect(applyWorkloadPolicy({}, { adapter: { applyAction: jest.fn() } })).rejects.toThrow('plan is invalid');
    await expect(applyWorkloadPolicy({ version: 1, operations: [{}] }, { adapter: { applyAction: jest.fn() } })).resolves.toMatchObject({ rejected: [expect.objectContaining({ reason: 'operation PID is invalid' })] });
  });
});

