/**
 * Native power manager tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { applyPowerProfile, previewPowerProfile, recommendPowerProfile, POWER_MANAGER_VERSION, POWER_PROFILES } from '../native/power-manager.js';

const adapter = { applyAction: jest.fn(async () => ({ ok: true })) };

describe('native power manager', () => {
  beforeEach(() => adapter.applyAction.mockClear());

  test('maps named profiles to documented platform controls and warns', () => {
    expect(POWER_PROFILES).toHaveLength(8);
    expect(previewPowerProfile('gaming', { platform: 'win32', facts: { battery: { batteries: [{ capacityPercent: 10 }] }, thermals: { maxTemperatureC: 92 } } })).toMatchObject({ version: POWER_MANAGER_VERSION, state: 'plan-ready', adapterProfile: 'performance', warnings: ['battery-charge-low', 'thermal-headroom-low'], requiresApproval: true, mutation: 'none' });
    expect(previewPowerProfile('balanced', { platform: 'linux' })).toMatchObject({ adapterProfile: 'balanced', note: 'direct-documented-profile' });
    expect(previewPowerProfile('developer', { platform: 'darwin' })).toMatchObject({ state: 'unsupported-platform', adapterProfile: 'balanced' });
    expect(() => previewPowerProfile('turbo')).toThrow('Unsupported power profile');
    expect(() => previewPowerProfile()).toThrow('unknown');
    expect(previewPowerProfile('quiet', { platform: 'freebsd', facts: { battery: { batteries: [{}] }, thermals: { maxTemperatureC: 89 } } })).toMatchObject({ state: 'unsupported-platform', warnings: [] });
  });

  test('recommends based on thermal, game, charging, and default evidence', () => {
    expect(recommendPowerProfile({ thermals: { maxTemperatureC: 90 } })).toEqual({ profile: 'quiet', reason: 'thermal-headroom-low' });
    expect(recommendPowerProfile({ game: { detected: true } })).toEqual({ profile: 'gaming', reason: 'foreground-game-observed' });
    expect(recommendPowerProfile({ battery: { batteries: [{ status: 'charging' }] } })).toEqual({ profile: 'developer', reason: 'external-power-observed' });
    expect(recommendPowerProfile({})).toEqual({ profile: 'balanced', reason: 'no-special-condition-observed' });
    expect(recommendPowerProfile({ battery: { batteries: [{}] }, thermals: { maxTemperatureC: 89 }, game: { detected: false } })).toEqual({ profile: 'balanced', reason: 'no-special-condition-observed' });
    expect(recommendPowerProfile()).toEqual({ profile: 'balanced', reason: 'no-special-condition-observed' });
    expect(() => recommendPowerProfile(null)).toThrow('facts');
  });

  test('requires approval and reports dry-run, unsupported, adapter rejection, and apply', async () => {
    const plan = previewPowerProfile('gaming', { platform: 'win32' });
    await expect(applyPowerProfile(plan, { adapter })).resolves.toMatchObject({ state: 'approval-required', applied: false });
    await expect(applyPowerProfile(plan, { adapter, approved: true })).resolves.toMatchObject({ state: 'preview', applied: false });
    await expect(applyPowerProfile(previewPowerProfile('gaming', { platform: 'darwin' }), { adapter, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'unsupported', applied: false });
    await expect(applyPowerProfile(plan, { adapter, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'applied', applied: true, adapterProfile: 'performance' });
    const rejecting = { applyAction: jest.fn(async () => ({ ok: false, reason: 'denied' })) };
    await expect(applyPowerProfile(plan, { adapter: rejecting, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'denied' });
    await expect(applyPowerProfile(plan, { adapter: { applyAction: jest.fn(async () => { throw new Error('boom'); }) }, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'boom' });
    await expect(applyPowerProfile(plan, { adapter: { applyAction: jest.fn(async () => ({ ok: false })) }, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'adapter rejected power profile' });
    await expect(applyPowerProfile()).rejects.toThrow('plan');
    await expect(applyPowerProfile(plan, { adapter: null, approved: true })).rejects.toThrow('adapter');
    await expect(applyPowerProfile({ version: 1, operation: 'other' }, { adapter })).rejects.toThrow('plan');
  });
});
