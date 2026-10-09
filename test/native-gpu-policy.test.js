/**
 * Native GPU policy tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { applyGpuPolicy, previewGpuPolicy, GPU_POLICY_VERSION } from '../native/gpu-policy.js';

const facts = {
  platform: 'linux',
  gpu: { available: true, vendor: 'nvidia', powerLimitWatts: 80, powerMinLimitWatts: 50, powerMaxLimitWatts: 100 }
};

describe('native GPU policy', () => {
  test('plans bounded NVIDIA power policies without claiming FPS control', () => {
    expect(previewGpuPolicy(facts, { policy: 'battery' })).toMatchObject({ version: GPU_POLICY_VERSION, state: 'plan-ready', operation: { limitWatts: 60 }, unsupported: ['fps-control'] });
    expect(previewGpuPolicy(facts, { policy: 'balanced' })).toMatchObject({ operation: { limitWatts: 80 } });
    expect(previewGpuPolicy(facts, { policy: 'performance' })).toMatchObject({ operation: { limitWatts: 100 }, restore: { limitWatts: 80 } });
    expect(previewGpuPolicy({ platform: 'darwin', gpu: facts.gpu })).toMatchObject({ state: 'unsupported-limit', reason: expect.stringContaining('power-limit') });
    expect(previewGpuPolicy({ platform: 'linux', gpu: { available: true, vendor: 'nvidia' } })).toMatchObject({ state: 'unsupported-limit', reason: expect.stringContaining('power-limit') });
    expect(previewGpuPolicy({ platform: 'linux', gpu: { available: true, vendor: 'amd', powerLimitWatts: 80, powerMinLimitWatts: 50, powerMaxLimitWatts: 100 } })).toMatchObject({ state: 'unsupported-limit' });
    expect(previewGpuPolicy({ platform: 'linux', gpu: { available: true, vendor: 'nvidia', powerLimitWatts: 80, powerMinLimitWatts: 110, powerMaxLimitWatts: 100 } })).toMatchObject({ state: 'unsupported-limit' });
    expect(previewGpuPolicy({ platform: 'linux', gpu: { available: true, vendor: 'nvidia', powerLimitWatts: 9, powerMinLimitWatts: 10, powerMaxLimitWatts: 100 } })).toMatchObject({ state: 'unsupported-limit' });
    expect(previewGpuPolicy()).toMatchObject({ state: 'unsupported-limit', platform: 'unknown', reason: expect.stringContaining('supported') });
    expect(() => previewGpuPolicy(null)).toThrow('facts');
    expect(() => previewGpuPolicy(facts, { policy: 'turbo' })).toThrow('Unsupported GPU policy');
    expect(() => previewGpuPolicy(facts, { policy: '' })).toThrow('unknown');
  });

  test('enforces approval, admin, dry-run, refusal, and adapter-result boundaries', async () => {
    const plan = previewGpuPolicy(facts, { policy: 'balanced' });
    const adapter = { applyAction: jest.fn(async () => ({ ok: true })) };
    await expect(applyGpuPolicy(plan, { adapter })).resolves.toMatchObject({ state: 'approval-required', applied: false });
    await expect(applyGpuPolicy(plan, { adapter, approved: true })).resolves.toMatchObject({ state: 'preview', limitWatts: 80 });
    await expect(applyGpuPolicy(previewGpuPolicy({ platform: 'darwin' }), { adapter, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'unsupported', applied: false });
    await expect(applyGpuPolicy({ ...plan, operation: null }, { adapter, approved: true, dryRun: false })).rejects.toThrow('plan');
    await expect(applyGpuPolicy({ ...plan, state: 'review-required' }, { adapter, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'unsupported', applied: false });
    await expect(applyGpuPolicy(plan, { adapter, approved: true, allowAdmin: true, dryRun: false })).resolves.toMatchObject({ state: 'applied', restoreLimitWatts: 80 });
    expect(adapter.applyAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'set-gpu-policy', limitWatts: 80 }), { approved: true, allowAdmin: true });
    const rejecting = { applyAction: jest.fn(async () => ({ ok: false, reason: 'denied' })) };
    await expect(applyGpuPolicy(plan, { adapter: rejecting, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'denied' });
    await expect(applyGpuPolicy(plan, { adapter: { applyAction: jest.fn(async () => ({ ok: false })) }, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'adapter rejected GPU policy' });
    await expect(applyGpuPolicy(plan, { adapter: { applyAction: jest.fn(async () => { throw new Error('boom'); }) }, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'boom' });
    await expect(applyGpuPolicy()).rejects.toThrow('plan');
    await expect(applyGpuPolicy(plan, { adapter: null, approved: true })).rejects.toThrow('adapter');
  });
});
