/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Cross-platform named power-profile policy. Names map only to documented
 * adapter profiles; no firmware or undocumented fan register is touched.
 */

export const POWER_MANAGER_VERSION = 1;
export const POWER_PROFILES = Object.freeze(['battery', 'quiet', 'balanced', 'developer', 'heavy-build', 'gaming', 'heavy-ai', 'overnight']);
const BASE_PROFILE = Object.freeze({ battery: 'battery', quiet: 'battery', balanced: 'balanced', developer: 'balanced', 'heavy-build': 'performance', gaming: 'performance', 'heavy-ai': 'performance', overnight: 'battery' });

function text(value) { return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null; }
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function rows(value) { return Array.isArray(value) ? value.filter(record) : []; }
function requireProfile(value) { const profile = text(value); if (!POWER_PROFILES.includes(profile)) throw new Error(`Unsupported power profile: ${value || 'unknown'}`); return profile; }

export function previewPowerProfile(profile, { platform = 'unknown', facts = {} } = {}) {
  const requested = requireProfile(profile);
  const mapped = BASE_PROFILE[requested];
  const battery = rows(facts?.battery?.batteries)[0] || null;
  const thermal = Number.isFinite(facts?.thermals?.maxTemperatureC) ? facts.thermals.maxTemperatureC : null;
  const warnings = [
    battery?.capacityPercent !== undefined && battery.capacityPercent !== null && battery.capacityPercent <= 15 ? 'battery-charge-low' : null,
    thermal !== null && thermal >= 90 ? 'thermal-headroom-low' : null
  ].filter(Boolean);
  return Object.freeze({ version: POWER_MANAGER_VERSION, state: platform === 'win32' || platform === 'linux' ? 'plan-ready' : 'unsupported-platform', platform, requestedProfile: requested, adapterProfile: mapped, operation: 'set-power-profile', warnings: Object.freeze(warnings), requiresApproval: true, mutation: 'none', note: requested === mapped ? 'direct-documented-profile' : `mapped-to-documented-${mapped}` });
}

export async function applyPowerProfile(plan, { adapter, approved = false, allowAdmin = false, dryRun = true } = {}) {
  if (!record(plan) || plan.version !== POWER_MANAGER_VERSION || plan.operation !== 'set-power-profile') throw new TypeError('Power profile plan is invalid');
  if (!adapter || typeof adapter.applyAction !== 'function') throw new TypeError('Power manager requires a platform adapter');
  if (!approved) return Object.freeze({ state: 'approval-required', applied: false, operation: plan.operation, profile: plan.requestedProfile });
  if (plan.state !== 'plan-ready') return Object.freeze({ state: 'unsupported', applied: false, operation: plan.operation, profile: plan.requestedProfile });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, operation: plan.operation, profile: plan.requestedProfile });
  try {
    const result = await adapter.applyAction({ type: 'set-power-profile', value: plan.adapterProfile }, { approved: true, allowAdmin });
    return Object.freeze(result?.ok ? { state: 'applied', applied: true, operation: plan.operation, profile: plan.requestedProfile, adapterProfile: plan.adapterProfile } : { state: 'rejected', applied: false, operation: plan.operation, profile: plan.requestedProfile, reason: result?.reason || 'adapter rejected power profile' });
  } catch (error) { return Object.freeze({ state: 'rejected', applied: false, operation: plan.operation, profile: plan.requestedProfile, reason: error.message }); }
}

export function recommendPowerProfile(facts = {}) {
  if (!record(facts)) throw new TypeError('Power recommendation facts must be an object');
  const battery = rows(facts.battery?.batteries)[0];
  const game = facts.game?.detected === true;
  const thermal = Number.isFinite(facts.thermals?.maxTemperatureC) ? facts.thermals.maxTemperatureC : null;
  if (thermal !== null && thermal >= 90) return Object.freeze({ profile: 'quiet', reason: 'thermal-headroom-low' });
  if (game) return Object.freeze({ profile: 'gaming', reason: 'foreground-game-observed' });
  if (battery?.status && /charging|ac/i.test(String(battery.status))) return Object.freeze({ profile: 'developer', reason: 'external-power-observed' });
  return Object.freeze({ profile: 'balanced', reason: 'no-special-condition-observed' });
}
