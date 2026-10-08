/**
 * Native workload budget tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { applyWorkloadBudget, createWorkloadBudgetMonitor, previewWorkloadBudget, WORKLOAD_BUDGET_VERSION } from '../native/workload-budget.js';

const facts = {
  processes: [
    { pid: 11, name: 'build', role: 'compiler', cpuPercent: 90, memoryBytes: 900, ioBytesPerSecond: 500, gpuPercent: 80, priority: 'normal', ioPriority: 'normal' },
    { pid: 12, name: 'game', role: 'game', foreground: true, cpuPercent: 99 },
    { pid: 13, name: 'model', role: 'model', cpuPercent: 99 },
    { pid: 14, name: 'background', role: 'other', cpuPercent: 1 }
  ]
};

describe('native workload budget supervisor', () => {
  test('detects supported and unsupported budget breaches while protecting processes', () => {
    const plan = previewWorkloadBudget(facts, { budget: { cpuPercent: 50, memoryBytes: 800, ioBytesPerSecond: 400, gpuPercent: 70 } });
    expect(plan).toMatchObject({ version: WORKLOAD_BUDGET_VERSION, state: 'plan-ready', operations: expect.arrayContaining([expect.objectContaining({ pid: 11, type: 'set-process-priority' }), expect.objectContaining({ pid: 11, type: 'set-process-io-priority' })]), protectedProcessCount: 2, unsupportedDimensions: ['memoryBytes', 'gpuPercent'] });
    expect(plan.breaches).toHaveLength(4);
    expect(plan.restore).toEqual(expect.arrayContaining([expect.objectContaining({ pid: 11, value: 'normal', previousValue: 'low' })]));
    expect(previewWorkloadBudget(facts, { budget: { memoryBytes: 800, gpuPercent: 70 }, targetPids: [11] })).toMatchObject({ state: 'unsupported-limit', operations: [] });
    expect(previewWorkloadBudget(facts, { budget: { cpuPercent: 2 }, targetPids: [14] })).toMatchObject({ state: 'within-budget' });
    expect(previewWorkloadBudget(facts, { targetPids: [11] })).toMatchObject({ state: 'budget-required' });
    expect(previewWorkloadBudget({ processes: null }, { budget: null, targetPids: null })).toMatchObject({ state: 'budget-required', protectedProcessCount: 0 });
    expect(previewWorkloadBudget()).toMatchObject({ state: 'budget-required' });
    expect(previewWorkloadBudget({ processes: [null, { pid: 15, protected: true, cpuPercent: 99 }] }, { budget: { cpuPercent: 1 } })).toMatchObject({ state: 'within-budget', protectedProcessCount: 1 });
    expect(previewWorkloadBudget({ processes: [{ pid: 16, cpuPercent: 1 }] }, { budget: { cpuPercent: 100 } })).toMatchObject({ state: 'within-budget' });
  });

  test('applies only approved operations and reports adapter outcomes', async () => {
    const plan = previewWorkloadBudget(facts, { budget: { cpuPercent: 50, ioBytesPerSecond: 400 } });
    const calls = [];
    const adapter = { requiresAdmin: () => false, applyAction: async (action, context) => { calls.push({ action, context }); return { ok: true }; } };
    expect(await applyWorkloadBudget(plan, { adapter, approvedPids: [], dryRun: true })).toMatchObject({ skipped: expect.any(Array), wouldApply: [] });
    expect(await applyWorkloadBudget(plan, { adapter, approvedPids: [11], dryRun: true })).toMatchObject({ wouldApply: expect.any(Array) });
    expect(await applyWorkloadBudget(plan, { adapter, approvedPids: true, dryRun: true })).toMatchObject({ wouldApply: expect.any(Array) });
    expect(await applyWorkloadBudget(plan, { adapter, approvedPids: [11], dryRun: false })).toMatchObject({ applied: expect.any(Array), rejected: [] });
    expect(calls).toHaveLength(2);
    const admin = { requiresAdmin: () => true, applyAction: jest.fn() };
    expect(await applyWorkloadBudget(plan, { adapter: admin, approvedPids: [11], dryRun: false })).toMatchObject({ adminRequired: expect.any(Array), applied: [] });
    expect(await applyWorkloadBudget(plan, { adapter: admin, approvedPids: [11], allowAdmin: true, dryRun: false })).toMatchObject({ applied: expect.any(Array) });
    const rejected = { applyAction: jest.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: false, reason: 'denied' }) };
    expect(await applyWorkloadBudget(plan, { adapter: rejected, approvedPids: [11], dryRun: false })).toMatchObject({ rejected: expect.any(Array) });
    expect(await applyWorkloadBudget({ ...plan, operations: [{ pid: 0 }] }, { adapter: rejected, approvedPids: true, dryRun: false })).toMatchObject({ rejected: [{ reason: 'operation PID is invalid' }] });
    await expect(applyWorkloadBudget(null, { adapter })).rejects.toThrow('invalid');
    await expect(applyWorkloadBudget(plan)).rejects.toThrow('platform adapter');
  });

  test('runs and stops a trigger monitor with opt-in automatic soft limiting', async () => {
    const plans = [];
    const errors = [];
    const timers = [];
    const adapter = { collectFacts: async () => facts, applyAction: async () => ({ ok: true }) };
    const monitor = createWorkloadBudgetMonitor({ adapter, budget: { cpuPercent: 50 }, approvedPids: [11], autoApply: true, intervalMs: 1000, onPlan: async (plan, report) => plans.push({ plan, report }), onError: (error) => errors.push(error), setIntervalImpl: (callback, delay) => { timers.push({ callback, delay }); return 'timer'; }, clearIntervalImpl: (timer) => timers.push({ timer }) });
    expect(monitor.version).toBe(WORKLOAD_BUDGET_VERSION);
    expect(monitor.stop()).toMatchObject({ stopped: false });
    expect((await monitor.collect()).report).toMatchObject({ applied: expect.any(Array) });
    expect(monitor.start()).toMatchObject({ started: true, intervalMs: 1000 });
    expect(monitor.start()).toMatchObject({ started: false });
    timers[0].callback();
    await new Promise((resolve) => setImmediate(resolve));
    expect(plans).toHaveLength(2);
    expect(monitor.stop()).toEqual({ stopped: true });
    expect(monitor.stop()).toMatchObject({ stopped: false });
    expect(monitor.isRunning()).toBe(false);
    expect(errors).toEqual([]);
    const defaults = createWorkloadBudgetMonitor({ adapter, budget: { cpuPercent: 200 } });
    await expect(defaults.collect()).resolves.toMatchObject({ report: null });
    defaults.start();
    expect(defaults.stop()).toMatchObject({ stopped: true });
    const defaultError = createWorkloadBudgetMonitor({ adapter: { collectFacts: async () => { throw new Error('ignored'); }, applyAction: async () => ({ ok: true }) }, budget: { cpuPercent: 50 }, setIntervalImpl: (callback) => { callback(); return 1; }, clearIntervalImpl: () => {} });
    defaultError.start();
    await new Promise((resolve) => setImmediate(resolve));
    expect(() => createWorkloadBudgetMonitor({ adapter, budget: {}, autoApply: true })).toThrow('approved PIDs');
    expect(() => createWorkloadBudgetMonitor({ adapter, budget: {}, intervalMs: 999 })).toThrow('interval');
    expect(() => createWorkloadBudgetMonitor({ adapter, budget: {}, onPlan: null })).toThrow('callbacks');
    expect(() => createWorkloadBudgetMonitor()).toThrow('platform adapter');
    const failing = createWorkloadBudgetMonitor({ adapter: { collectFacts: async () => { throw new Error('facts failed'); }, applyAction: async () => ({ ok: true }) }, budget: { cpuPercent: 50 }, onError: (error) => errors.push(error), setIntervalImpl: (callback) => { callback(); return 1; }, clearIntervalImpl: () => {} });
    failing.start();
    await new Promise((resolve) => setImmediate(resolve));
    expect(errors.at(-1).message).toBe('facts failed');
    await expect(failing.collect()).rejects.toThrow('facts failed');
  });

  test('validates facts and PID inputs', () => {
    expect(() => previewWorkloadBudget(null)).toThrow('facts');
    expect(previewWorkloadBudget({ processes: [{ pid: 0, role: 'other' }] }, { budget: { cpuPercent: 101 } })).toMatchObject({ state: 'budget-required' });
    expect(previewWorkloadBudget({ processes: [{ pid: 1, role: 'other', cpuPercent: 2 }] }, { budget: { cpuPercent: 1 }, targetPids: [1, 1, 0, 'bad'] })).toMatchObject({ targetPids: [1], state: 'plan-ready' });
  });
});
