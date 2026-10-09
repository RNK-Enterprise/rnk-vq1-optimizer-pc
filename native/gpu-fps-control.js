/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Vendor-aware GPU power and FPS control planning. A hard FPS operation is
 * emitted only when the host reports an installed, named controller backend.
 */

import { previewGpuPolicy } from './gpu-policy.js';
import { MAX_FPS_LIMIT, MIN_FPS_LIMIT } from './protocol.js';

export const GPU_FPS_CONTROL_VERSION = 1;
const BACKENDS = Object.freeze(['rtss', 'gamescope', 'driver']);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function fps(value) { return Number.isInteger(value) && value >= MIN_FPS_LIMIT && value <= MAX_FPS_LIMIT ? value : null; }
function operation(facts, fpsLimit) {
  const controller = record(facts.gpu?.fpsController) ? facts.gpu.fpsController : {};
  if (controller.available !== true || !BACKENDS.includes(controller.backend)) return null;
  return Object.freeze({ type: 'set-fps-policy', key: 'fps.policy', value: 'cap', limit: fpsLimit, backend: controller.backend, pid: Number.isInteger(controller.pid) ? controller.pid : undefined, requiresApproval: true, requiresAdmin: controller.backend !== 'gamescope' });
}

export function previewGpuFpsControl(facts = {}, { policy = 'balanced', powerLimitWatts = null, fpsLimit = null } = {}) {
  if (!record(facts)) throw new TypeError('GPU/FPS control facts must be an object');
  const wantsPower = powerLimitWatts !== null;
  const wantsFps = fpsLimit !== null;
  if (!wantsPower && !wantsFps) return Object.freeze({ version: GPU_FPS_CONTROL_VERSION, state: 'limit-required', operations: Object.freeze([]), unsupported: Object.freeze([]) });
  const operations = [];
  const unsupported = [];
  if (wantsPower) {
    const power = previewGpuPolicy(facts, { policy });
    if (power.state === 'plan-ready' && Number.isFinite(powerLimitWatts) && powerLimitWatts >= power.limits.minimumWatts && powerLimitWatts <= power.limits.maximumWatts) operations.push(Object.freeze({ ...power.operation, limitWatts: powerLimitWatts }));
    else unsupported.push('gpu-power-cap');
  }
  if (wantsFps) {
    const limit = fps(fpsLimit);
    const fpsOperation = limit === null ? null : operation(facts, limit);
    if (fpsOperation) operations.push(fpsOperation); else unsupported.push('fps-control');
  }
  return Object.freeze({ version: GPU_FPS_CONTROL_VERSION, state: operations.length ? 'plan-ready' : 'unsupported-control', platform: facts.platform || 'unknown', operations: Object.freeze(operations), unsupported: Object.freeze(unsupported), reason: operations.length ? 'bounded GPU controller operation is available' : 'no requested GPU/FPS controller is available' });
}

export async function applyGpuFpsControl(plan, { adapter, approved = false, allowAdmin = false, dryRun = true } = {}) {
  if (!record(plan) || plan.version !== GPU_FPS_CONTROL_VERSION || !Array.isArray(plan.operations)) throw new TypeError('GPU/FPS control plan is invalid');
  if (!adapter || typeof adapter.applyAction !== 'function') throw new TypeError('GPU/FPS control requires a platform adapter');
  if (plan.state === 'unsupported-control') return Object.freeze({ state: 'unsupported', applied: false, unsupported: plan.unsupported, reason: plan.reason });
  if (!approved) return Object.freeze({ state: 'approval-required', applied: false, operations: plan.operations });
  if (dryRun) return Object.freeze({ state: 'preview', applied: false, operations: plan.operations });
  const applied = [];
  const rejected = [];
  for (const action of plan.operations) {
    try {
      const result = await adapter.applyAction(action, { approved: true, allowAdmin });
      if (result?.ok === true) applied.push({ action, result }); else rejected.push({ action, reason: result?.reason || 'adapter rejected GPU/FPS operation' });
    } catch (error) { rejected.push({ action, reason: error.message }); }
  }
  return Object.freeze({ state: rejected.length ? 'rejected' : 'applied', applied: rejected.length === 0, operations: plan.operations, appliedOperations: Object.freeze(applied), rejected: Object.freeze(rejected) });
}
