/**
 * Universal GPU/FPS control tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { applyGpuFpsControl, previewGpuFpsControl } from '../native/gpu-fps-control.js';

const nvidia = { platform: 'win32', gpu: { available: true, vendor: 'nvidia', powerLimitWatts: 80, powerMinLimitWatts: 50, powerMaxLimitWatts: 100 } };

describe('universal GPU/FPS control', () => {
  test('plans bounded power and observed FPS controller operations', () => {
    expect(previewGpuFpsControl()).toMatchObject({ state: 'limit-required' });
    const facts = { ...nvidia, gpu: { ...nvidia.gpu, fpsController: { available: true, backend: 'rtss', pid: 42 } } };
    expect(previewGpuFpsControl(facts, { powerLimitWatts: 90, fpsLimit: 120 })).toMatchObject({ state: 'plan-ready', operations: [{ type: 'set-gpu-policy', limitWatts: 90 }, { type: 'set-fps-policy', limit: 120, backend: 'rtss', pid: 42 }] });
    expect(previewGpuFpsControl({ ...nvidia, gpu: { ...nvidia.gpu, fpsController: { available: true, backend: 'gamescope' } } }, { fpsLimit: 60 })).toMatchObject({ state: 'plan-ready', operations: [{ type: 'set-fps-policy', requiresAdmin: false }] });
    expect(previewGpuFpsControl(nvidia, { fpsLimit: 60 })).toMatchObject({ state: 'unsupported-control', unsupported: ['fps-control'] });
    expect(previewGpuFpsControl({ ...nvidia, gpu: { ...nvidia.gpu, fpsController: { available: true, backend: 'rtss' } } }, { fpsLimit: 29 })).toMatchObject({ state: 'unsupported-control', unsupported: ['fps-control'] });
    expect(previewGpuFpsControl(nvidia, { powerLimitWatts: 120 })).toMatchObject({ state: 'unsupported-control', unsupported: ['gpu-power-cap'] });
    expect(previewGpuFpsControl(nvidia)).toMatchObject({ state: 'limit-required' });
    expect(previewGpuFpsControl({ platform: 'darwin' }, { powerLimitWatts: 40, fpsLimit: 60 })).toMatchObject({ state: 'unsupported-control', unsupported: ['gpu-power-cap', 'fps-control'] });
    expect(previewGpuFpsControl({ gpu: { available: false }, fpsController: {} }, { fpsLimit: 60 })).toMatchObject({ platform: 'unknown' });
    expect(() => previewGpuFpsControl(null, { fpsLimit: 60 })).toThrow('facts');
  });

  test('applies only approved plans and reports each backend result', async () => {
    const plan = previewGpuFpsControl({ ...nvidia, gpu: { ...nvidia.gpu, fpsController: { available: true, backend: 'rtss', pid: 42 } } }, { powerLimitWatts: 90, fpsLimit: 120 });
    const adapter = { applyAction: jest.fn(async () => ({ ok: true })) };
    await expect(applyGpuFpsControl(plan, { adapter })).resolves.toMatchObject({ state: 'approval-required', applied: false });
    await expect(applyGpuFpsControl(plan, { adapter, approved: true, dryRun: true })).resolves.toMatchObject({ state: 'preview', applied: false });
    await expect(applyGpuFpsControl(previewGpuFpsControl(nvidia, { fpsLimit: 60 }), { adapter, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'unsupported', applied: false });
    await expect(applyGpuFpsControl(plan, { adapter, approved: true, dryRun: false, allowAdmin: true })).resolves.toMatchObject({ state: 'applied', applied: true, appliedOperations: expect.any(Array) });
    const rejecting = { applyAction: jest.fn(async () => ({ ok: false, reason: 'backend denied' })) };
    await expect(applyGpuFpsControl(plan, { adapter: rejecting, approved: true, dryRun: false })).resolves.toEqual(expect.objectContaining({ state: 'rejected', rejected: expect.arrayContaining([expect.objectContaining({ reason: 'backend denied' })]) }));
    const throwing = { applyAction: jest.fn(async () => { throw new Error('backend crashed'); }) };
    await expect(applyGpuFpsControl(plan, { adapter: throwing, approved: true, dryRun: false })).resolves.toEqual(expect.objectContaining({ state: 'rejected', rejected: expect.arrayContaining([expect.objectContaining({ reason: 'backend crashed' })]) }));
    const noReason = { applyAction: jest.fn(async () => ({ ok: false })) };
    await expect(applyGpuFpsControl(plan, { adapter: noReason, approved: true, dryRun: false })).resolves.toEqual(expect.objectContaining({ state: 'rejected', rejected: expect.arrayContaining([expect.objectContaining({ reason: 'adapter rejected GPU/FPS operation' })]) }));
    await expect(applyGpuFpsControl()).rejects.toThrow('plan');
    await expect(applyGpuFpsControl(plan, { adapter: null })).rejects.toThrow('adapter');
  });
});
