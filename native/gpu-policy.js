/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded NVIDIA power-cap policy. It does not claim frame-rate control or
 * support GPUs whose current, minimum, and maximum limits are not observed.
 */

import { GPU_POLICIES } from './protocol.js';

export const GPU_POLICY_VERSION = 1;
const RATIOS = Object.freeze({ battery: 0.6, balanced: 0.8, performance: 1 });
const MIN_WATTS = 10;
const MAX_WATTS = 2000;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function watts(value) { return Number.isFinite(value) && value >= MIN_WATTS && value <= MAX_WATTS ? value : null; }
function requirePolicy(value) { if (!GPU_POLICIES.includes(value)) throw new Error(`Unsupported GPU policy: ${value || 'unknown'}`); return value; }
function supportedFacts(facts) {
  const gpu = record(facts.gpu) ? facts.gpu : {};
  return facts.platform === 'win32' || facts.platform === 'linux'
    ? { gpu, current: watts(gpu.powerLimitWatts), minimum: watts(gpu.powerMinLimitWatts), maximum: watts(gpu.powerMaxLimitWatts) }
    : { gpu, current: null, minimum: null, maximum: null };
}

export function previewGpuPolicy(facts = {}, { policy = 'balanced' } = {}) {
  if (!record(facts)) throw new TypeError('GPU policy facts must be an object');
  const requested = requirePolicy(policy);
  const observed = supportedFacts(facts);
  const available = observed.gpu.available === true && observed.gpu.vendor === 'nvidia';
  const ready = available && observed.current !== null && observed.minimum !== null && observed.maximum !== null && observed.minimum <= observed.maximum;
  if (!ready) return Object.freeze({ version: GPU_POLICY_VERSION, state: 'unsupported-limit', platform: facts.platform || 'unknown', policy: requested, currentPowerLimitWatts: observed.current, limits: { minimumWatts: observed.minimum, maximumWatts: observed.maximum }, operation: null, unsupported: ['fps-control', 'gpu-hard-cap'], reason: available ? 'bounded NVIDIA power-limit range is unavailable' : 'supported NVIDIA GPU evidence is unavailable' });
  const target = Math.min(observed.maximum, Math.max(observed.minimum, Math.round(observed.maximum * RATIOS[requested])));
  return Object.freeze({ version: GPU_POLICY_VERSION, state: 'plan-ready', platform: facts.platform, policy: requested, currentPowerLimitWatts: observed.current, limits: { minimumWatts: observed.minimum, maximumWatts: observed.maximum }, operation: { type: 'set-gpu-policy', key: 'gpu.policy', value: requested, limitWatts: target, requiresApproval: true, requiresAdmin: true }, restore: { limitWatts: observed.current, state: 'review-required' }, unsupported: ['fps-control'], reason: 'bounded NVIDIA power-limit evidence is available' });
}

export async function applyGpuPolicy(plan, { adapter, approved = false, allowAdmin = false, dryRun = true } = {}) {
  if (!record(plan) || plan.version !== GPU_POLICY_VERSION) throw new TypeError('GPU policy plan is invalid');
  if (!adapter || typeof adapter.applyAction !== 'function') throw new TypeError('GPU policy requires a platform adapter');
  if (plan.state === 'unsupported-limit') return Object.freeze({ state: 'unsupported', applied: false, policy: plan.policy, reason: plan.reason });
  if (!record(plan.operation)) throw new TypeError('GPU policy plan is invalid');
  if (!approved) return Object.freeze({ state: 'approval-required', applied: false, policy: plan.policy });
  if (plan.state !== 'plan-ready') return Object.freeze({ state: 'unsupported', applied: false, policy: plan.policy, reason: plan.reason });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, policy: plan.policy, limitWatts: plan.operation.limitWatts });
  try {
    const result = await adapter.applyAction(plan.operation, { approved: true, allowAdmin });
    return Object.freeze(result?.ok ? { state: 'applied', applied: true, policy: plan.policy, limitWatts: plan.operation.limitWatts, restoreLimitWatts: plan.restore.limitWatts } : { state: 'rejected', applied: false, policy: plan.policy, reason: result?.reason || 'adapter rejected GPU policy' });
  } catch (error) {
    return Object.freeze({ state: 'rejected', applied: false, policy: plan.policy, reason: error.message });
  }
}
