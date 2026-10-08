/**
 * Native resource-limit planning tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { applyResourceLimits, previewResourceLimits, RESOURCE_LIMITS_VERSION } from '../native/resource-limits.js';

const facts = {
  processes: [
    { pid: 11, name: ' build ', role: 'compiler' },
    { pid: 12, name: 'game', foreground: true },
    { pid: 13, name: 'model', role: 'MODEL' },
    { pid: 14, name: 'protected', protected: true },
    { pid: 15, name: '   ', role: 'other' },
    { pid: 0, name: 'invalid' },
    null
  ]
};
const MEMORY_LIMIT = 64 * 1024 * 1024;

describe('native resource limits', () => {
  test('builds bounded plans and protects foreground and sensitive workloads', () => {
    const plan = previewResourceLimits(facts, { limits: { cpuPercent: 50, memoryBytes: MEMORY_LIMIT }, targetPids: [11, 11, 0, 'bad', 15] });
    expect(plan).toMatchObject({ version: RESOURCE_LIMITS_VERSION, state: 'plan-ready', targetPids: [11, 15], protectedProcessCount: 3 });
    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ pid: 11, value: 'cpu-percent', limit: 50, name: 'build' }),
      expect.objectContaining({ pid: 11, value: 'memory-bytes', limit: MEMORY_LIMIT }),
      expect.objectContaining({ pid: 15, name: 'unknown' })
    ]));
    expect(plan.operations).toHaveLength(4);
    expect(previewResourceLimits(facts, { limits: { cpuPercent: 50 } }).operations).toHaveLength(2);
    expect(previewResourceLimits(facts, { limits: null, targetPids: null })).toMatchObject({ state: 'limit-required', limits: { cpuPercent: null, memoryBytes: null } });
    expect(previewResourceLimits(facts, { limits: { cpuPercent: 101, memoryBytes: 0 } })).toMatchObject({ state: 'limit-required', limits: { cpuPercent: null, memoryBytes: null } });
    expect(previewResourceLimits(facts, { limits: { memoryBytes: 1 } })).toMatchObject({ state: 'limit-required' });
    expect(previewResourceLimits(facts, { limits: { memoryBytes: 2 ** 41 } })).toMatchObject({ state: 'limit-required' });
    expect(previewResourceLimits(facts, { limits: { cpuPercent: 50 }, targetPids: [12] })).toMatchObject({ state: 'protected-or-unselected', operations: [] });
    expect(previewResourceLimits({ processes: null }, { limits: { memoryBytes: MEMORY_LIMIT } })).toMatchObject({ state: 'protected-or-unselected', protectedProcessCount: 0 });
    expect(previewResourceLimits()).toMatchObject({ state: 'limit-required' });
    expect(() => previewResourceLimits(null)).toThrow('facts');
  });

  test('applies only explicitly approved resource operations', async () => {
    const plan = previewResourceLimits({ processes: [{ pid: 11, name: 'build' }] }, { limits: { cpuPercent: 50, memoryBytes: MEMORY_LIMIT } });
    const calls = [];
    const adapter = {
      requiresAdmin: (action) => action.value === 'memory-bytes',
      applyAction: jest.fn(async (action, context) => {
        calls.push({ action, context });
        if (action.value === 'cpu-percent') return { ok: false };
        throw new Error('memory denied');
      })
    };
    expect(await applyResourceLimits(plan, { adapter, approvedPids: [], dryRun: true })).toMatchObject({ skipped: expect.any(Array), wouldApply: [] });
    expect(await applyResourceLimits(plan, { adapter, approvedPids: [11], dryRun: true })).toMatchObject({ wouldApply: expect.any(Array), adminRequired: [{ approved: false }] });
    expect(await applyResourceLimits(plan, { adapter, approvedPids: true, allowAdmin: true, dryRun: false })).toMatchObject({ applied: [], rejected: expect.arrayContaining([expect.objectContaining({ reason: 'adapter rejected resource limit' }), expect.objectContaining({ reason: 'memory denied' })]) });
    expect(calls).toHaveLength(2);
    expect(await applyResourceLimits({ ...plan, operations: [{ pid: 0 }] }, { adapter, approvedPids: true, dryRun: false })).toMatchObject({ rejected: [{ reason: 'operation PID is invalid' }] });
    const noAdminMethod = { applyAction: jest.fn(async () => ({ ok: true })) };
    expect(await applyResourceLimits(plan, { adapter: noAdminMethod, approvedPids: [11], dryRun: false })).toMatchObject({ applied: expect.any(Array) });
    await expect(applyResourceLimits(null, { adapter })).rejects.toThrow('invalid');
    await expect(applyResourceLimits(plan)).rejects.toThrow('platform adapter');
  });
});
