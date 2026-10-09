/**
 * Native action audit tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { createAuditedNativeAgent } from '../native/action-audit.js';

const plan = { protocolVersion: 1, planId: 'plan-audit', actions: [] };

function harness() {
  const entries = [];
  let timestamp = 100;
  const facts = [
    { platform: 'linux', collectedAt: 'now', cpu: { load1: 1 }, memory: { usedPercent: 50 }, gpu: { available: false }, storage: [{ mount: '/' }], pagefile: {}, storagePressure: {}, battery: {}, thermals: { maxTemperatureC: 60 }, network: { interfaces: [{ name: 'eth0' }] }, processes: [{ pid: 1 }], startup: { entries: [{ name: 'one' }] } },
    {}
  ];
  const agent = {
    collectFacts: jest.fn(async () => facts.shift() || {}),
    requestPlan: jest.fn(async () => plan),
    applyPlan: jest.fn(async () => ({ dryRun: true, applied: [], wouldApply: [] }))
  };
  const historyStore = { append: jest.fn(async (entry) => { const saved = { ...entry, version: entries.length + 1 }; entries.push(saved); return saved; }) };
  return { agent, historyStore, entries, now: () => timestamp++ };
}

describe('native action audit', () => {
  test('requires complete authority dependencies', () => {
    expect(() => createAuditedNativeAgent()).toThrow('native agent');
    expect(() => createAuditedNativeAgent({ agent: { collectFacts() {}, applyPlan() {} } })).toThrow('native agent');
    const h = harness();
    expect(() => createAuditedNativeAgent({ agent: h.agent })).toThrow('history store');
    expect(() => createAuditedNativeAgent({ agent: h.agent, historyStore: {} })).toThrow('history store');
    expect(() => createAuditedNativeAgent({ agent: h.agent, historyStore: h.historyStore, now: 1 })).toThrow('clock');
  });

  test('records observation, preview, apply, and verification evidence', async () => {
    const h = harness();
    const audited = createAuditedNativeAgent(h);
    const result = await audited.applyPlan(plan, { dryRun: true });
    expect(result.report).toEqual({ dryRun: true, applied: [], wouldApply: [] });
    expect(result.history.map((entry) => entry.event)).toEqual(['observation', 'preview', 'apply', 'verify']);
    expect(h.historyStore.append).toHaveBeenCalledTimes(4);
    expect(result.verification.before).toMatchObject({ platform: 'linux', processCount: 1, startupCount: 1, volumes: [] });
    expect(result.verification.after).toMatchObject({ platform: 'unknown', processCount: 0, startupCount: 0 });
    expect(h.agent.applyPlan).toHaveBeenCalledWith(plan, { dryRun: true });
  });

  test('uses supplied before facts and preserves bounded empty facts', async () => {
    const h = harness();
    const audited = createAuditedNativeAgent({ ...h, now: () => 200 });
    const result = await audited.applyPlan({ ...plan, planId: '' }, { beforeFacts: null, approvedActions: true });
    expect(result.verification.before).toMatchObject({ platform: 'unknown', storage: [], volumes: [], network: null });
    expect(h.agent.collectFacts).toHaveBeenCalledTimes(1);
    expect(h.agent.applyPlan).toHaveBeenCalledWith({ ...plan, planId: '' }, { approvedActions: true });
    const sparse = await audited.applyPlan(plan, { beforeFacts: { thermals: {}, network: {} } });
    expect(sparse.verification.before).toMatchObject({ thermals: { maxTemperatureC: null }, network: { interfaces: [] } });
    const withVolumes = await audited.applyPlan(plan, { beforeFacts: { volumes: { volumes: [{ mount: 'C:' }, { mount: 'E:' }] } } });
    expect(withVolumes.verification.before.volumes).toEqual([{ mount: 'C:' }, { mount: 'E:' }]);
  });

  test('optimizes through the audited path and propagates history failures', async () => {
    const h = harness();
    const audited = createAuditedNativeAgent(h);
    const result = await audited.optimize({ profile: 'battery', dryRun: true });
    expect(result.facts).toMatchObject({ platform: 'linux' });
    expect(result.plan).toEqual(plan);
    expect(h.agent.requestPlan).toHaveBeenCalledWith(expect.objectContaining({ platform: 'linux' }), { profile: 'battery' });
    expect(h.agent.collectFacts).toHaveBeenCalledTimes(2);
    const defaults = harness();
    await expect(createAuditedNativeAgent(defaults).optimize()).resolves.toMatchObject({ plan });
    const applyCallsBeforeFailure = h.agent.applyPlan.mock.calls.length;
    const failing = { agent: h.agent, historyStore: { append: jest.fn().mockRejectedValue(new Error('ledger unavailable')) }, now: () => 1 };
    await expect(createAuditedNativeAgent(failing).applyPlan(plan)).rejects.toThrow('ledger unavailable');
    expect(h.agent.applyPlan).toHaveBeenCalledTimes(applyCallsBeforeFailure);
  });

  test('rejects invalid clocks before collecting or applying', async () => {
    const h = harness();
    await expect(createAuditedNativeAgent({ ...h, now: () => NaN }).applyPlan(plan)).rejects.toThrow('clock must return a number');
    expect(h.agent.collectFacts).not.toHaveBeenCalled();
  });
});
