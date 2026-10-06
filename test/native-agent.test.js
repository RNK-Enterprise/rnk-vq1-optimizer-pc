/**
 * Native optimizer agent tests.
 * Copyright © 2026 RNK Enterprise
 * Contributor: RNK Enterprise
 */

import { NativeOptimizerAgent } from '../native/agent.js';

const plan = {
  protocolVersion: 1,
  planId: 'plan-1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  actions: [
    { type: 'set-power-profile', key: 'power.profile', value: 'performance' },
    { type: 'clear-cache', key: 'cache', value: 'user-temp' }
  ]
};

function adapterHarness() {
  const calls = [];
  return {
    calls,
    adapter: {
      platform: 'linux',
      collectFacts: jest.fn(() => ({ cpu: { load1: 1 } })),
      requiresAdmin: jest.fn((action) => action.type === 'set-power-profile'),
      applyAction: jest.fn(async (action, context) => {
        calls.push({ action, context });
        return action.type === 'set-process-io-priority'
          ? { ok: false, reason: 'unsupported' }
          : action.type === 'set-process-affinity'
            ? { ok: false }
            : { ok: true };
      })
    }
  };
}

describe('NativeOptimizerAgent', () => {
  test('requires an adapter and known profile', () => {
    expect(() => new NativeOptimizerAgent()).toThrow('requires a platform adapter');
    const h = adapterHarness();
    expect(() => new NativeOptimizerAgent({ adapter: h.adapter, profile: 'turbo' })).toThrow('Unsupported native profile');
  });

  test('requests a VQ plan with a mapped profile and token', async () => {
    const h = adapterHarness();
    const fetchFn = jest.fn(async (_url, options) => {
      const request = JSON.parse(options.body);
      expect(request).toEqual(expect.objectContaining({ protocolVersion: 1, profile: 'battery-mobile', scope: 'self', clientId: 'pc-1', targetClientIds: [] }));
      expect(options.headers['x-optimizer-token']).toBe('secret');
      expect(options.signal).toBeDefined();
      return { ok: true, json: async () => ({ success: true, plan }) };
    });
    const agent = new NativeOptimizerAgent({ adapter: h.adapter, gatewayUrl: 'https://optimizer.test/plan', gatewayToken: 'secret', fetchFn, clientId: 'pc-1', now: () => 1000 });
    await expect(agent.requestPlan({ memory: { usedPercent: 50 } }, { profile: 'battery' })).resolves.toEqual(plan);
    expect(agent.collectFacts()).toEqual({ cpu: { load1: 1 } });

    const direct = new NativeOptimizerAgent({ adapter: h.adapter, gatewayUrl: 'http://direct', fetchFn: jest.fn().mockResolvedValue({ ok: true, json: async () => plan }), now: () => 1000 });
    await expect(direct.requestPlan({})).resolves.toEqual(plan);
  });

  test('fails closed for unavailable gateway states and malformed responses', async () => {
    const h = adapterHarness();
    const noUrl = new NativeOptimizerAgent({ adapter: h.adapter });
    await expect(noUrl.requestPlan({})).rejects.toThrow('gateway URL');
    const noFetch = new NativeOptimizerAgent({ adapter: h.adapter, gatewayUrl: 'http://x', fetchFn: null });
    await expect(noFetch.requestPlan({})).rejects.toThrow('Fetch is unavailable');
    const invalidProfile = new NativeOptimizerAgent({ adapter: h.adapter, gatewayUrl: 'http://x', fetchFn: jest.fn() });
    await expect(invalidProfile.requestPlan({}, { profile: 'turbo' })).rejects.toThrow('Unsupported native profile');
    const rejected = new NativeOptimizerAgent({ adapter: h.adapter, gatewayUrl: 'http://x', fetchFn: jest.fn().mockResolvedValue({ ok: false, status: 503 }) });
    await expect(rejected.requestPlan({})).rejects.toThrow('503');
    const unknownStatus = new NativeOptimizerAgent({ adapter: h.adapter, gatewayUrl: 'http://x', fetchFn: jest.fn().mockResolvedValue({ ok: false }) });
    await expect(unknownStatus.requestPlan({})).rejects.toThrow('unknown');
    const noJson = new NativeOptimizerAgent({ adapter: h.adapter, gatewayUrl: 'http://x', fetchFn: jest.fn().mockResolvedValue({ ok: true }) });
    await expect(noJson.requestPlan({})).rejects.toThrow('no JSON');
    const invalidPlan = new NativeOptimizerAgent({ adapter: h.adapter, gatewayUrl: 'http://x', fetchFn: jest.fn().mockResolvedValue({ ok: true, json: async () => ({ plan: { protocolVersion: 1 } }) }) });
    await expect(invalidPlan.requestPlan({})).rejects.toThrow('at most');
    const timedOutFetch = new NativeOptimizerAgent({
      adapter: h.adapter,
      gatewayUrl: 'http://timeout',
      fetchFn: jest.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))))),
      timeoutMs: 1
    });
    await expect(timedOutFetch.requestPlan({})).rejects.toThrow('aborted');
  });

  test('keeps normal-user, admin-required, destructive, invalid, and failed actions separate', async () => {
    const h = adapterHarness();
    const agent = new NativeOptimizerAgent({ adapter: h.adapter, targetPid: 77, approvedBackgroundPids: [77], now: () => 1000 });
    const mixed = {
      ...plan,
      actions: [
        ...plan.actions,
        { type: 'set-process-io-priority', key: 'process.io', value: 'low' },
        { type: 'not-real', key: 'x', value: 'y' }
      ]
    };
    const preview = await agent.applyPlan(mixed);
    expect(preview.dryRun).toBe(false);
    expect(preview.adminRequired).toEqual([{ action: plan.actions[0], approved: false }]);
    expect(preview.skipped[0].reason).toBe('explicit approval required');
    expect(preview.rejected[0].reason).toContain('unsupported');
    expect(preview.normalUser).toEqual([mixed.actions[2]]);
    expect(preview.applied).toHaveLength(0);
    expect(h.adapter.applyAction).toHaveBeenCalledWith(mixed.actions[2], expect.objectContaining({ targetPid: 77, approved: false }));

    const applied = await agent.applyPlan(mixed, { approvedActions: ['clear-cache:user-temp'], allowAdmin: true });
    expect(applied.adminRequired[0].approved).toBe(true);
    expect(applied.applied).toHaveLength(2);
    expect(applied.rejected).toHaveLength(2);

    const dryRun = await agent.applyPlan(plan, { approvedActions: true, allowAdmin: true, dryRun: true });
    expect(dryRun.wouldApply).toEqual(plan.actions);
    const normalDryRun = await agent.applyPlan({ ...plan, actions: [mixed.actions[2]] }, { dryRun: true });
    expect(normalDryRun.wouldApply).toEqual([mixed.actions[2]]);
    expect(h.adapter.applyAction).toHaveBeenCalledTimes(4);
    const fallback = await agent.applyPlan({ ...plan, actions: [{ type: 'set-process-affinity', key: 'process.affinity', value: 'balanced' }] }, { approvedActions: 'not-an-array' });
    expect(fallback.rejected[0].reason).toBe('adapter rejected action');
  });

  test('optimizes by collecting facts, requesting a plan, and applying by default in preview mode', async () => {
    const h = adapterHarness();
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ plan }) });
    const agent = new NativeOptimizerAgent({ adapter: h.adapter, gatewayUrl: 'http://x', fetchFn, now: () => 1000 });
    const result = await agent.optimize();
    expect(result.facts).toEqual({ cpu: { load1: 1 } });
    expect(result.plan).toEqual(plan);
    expect(result.report.dryRun).toBe(true);
    expect(result.report.wouldApply).toEqual([]);
    expect(result.report.adminRequired[0].action).toEqual(plan.actions[0]);
    expect(result.report.skipped[0].reason).toBe('explicit approval required');
    const appliedResult = await agent.optimize({ apply: true, allowAdmin: true, approvedActions: true });
    expect(appliedResult.report.dryRun).toBe(false);
  });
});
