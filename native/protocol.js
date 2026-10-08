/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/gpl-3.0.html>.
 *
 * VQ may propose data-only actions from this contract. The local agent is the
 * authority that validates and executes them; paths, commands, and arguments
 * are deliberately absent from the wire format.
 */

export const NATIVE_PROTOCOL_VERSION = 1;
export const MAX_NATIVE_ACTIONS = 24;
export const MAX_NATIVE_PLAN_TTL_MS = 5 * 60 * 1000;

export const POWER_PROFILES = Object.freeze(['balanced', 'performance', 'battery']);
export const PROCESS_PRIORITIES = Object.freeze(['low', 'normal', 'high']);
export const GPU_POLICIES = Object.freeze(['balanced', 'performance', 'battery']);
export const MEMORY_POLICIES = Object.freeze(['balanced', 'background-low']);
export const CACHE_TARGETS = Object.freeze(['user-temp', 'shader-cache', 'app-cache']);
export const RESOURCE_LIMITS = Object.freeze(['cpu-percent', 'memory-bytes']);
export const MIN_RESOURCE_MEMORY_BYTES = 16 * 1024 * 1024;
export const MAX_RESOURCE_MEMORY_BYTES = 1024 ** 4;

export const NATIVE_ACTIONS = Object.freeze([
  'set-power-profile',
  'set-process-priority',
  'set-process-io-priority',
  'set-process-affinity',
  'set-process-resource-limit',
  'set-gpu-policy',
  'set-memory-policy',
  'clear-cache',
  'stop-approved-process'
]);

export const DESTRUCTIVE_ACTIONS = Object.freeze(['clear-cache', 'stop-approved-process']);

function requireKey(action, expected) {
  if (action.key !== expected) throw new Error(`${action.type} requires key ${expected}`);
}

function requireChoice(action, choices) {
  if (typeof action.value !== 'string' || !choices.includes(action.value)) {
    throw new Error(`${action.type} has an unsupported value`);
  }
}

/** Validate one native action without resolving a path or executing a command. */
export function validateNativeAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    throw new TypeError('Native optimizer action must be an object');
  }
  if (!NATIVE_ACTIONS.includes(action.type)) {
    throw new Error(`Unsupported native optimizer action: ${action.type || 'unknown'}`);
  }
  if ('command' in action || 'args' in action || 'path' in action || 'paths' in action) {
    throw new Error('Native optimizer actions cannot contain commands or paths');
  }

  switch (action.type) {
    case 'set-power-profile':
      requireKey(action, 'power.profile');
      requireChoice(action, POWER_PROFILES);
      break;
    case 'set-process-priority':
      requireKey(action, 'process.priority');
      requireChoice(action, PROCESS_PRIORITIES);
      break;
    case 'set-process-io-priority':
      requireKey(action, 'process.io');
      requireChoice(action, PROCESS_PRIORITIES);
      break;
    case 'set-process-affinity':
      requireKey(action, 'process.affinity');
      requireChoice(action, ['balanced', 'performance']);
      break;
    case 'set-process-resource-limit':
      requireKey(action, 'process.resource-limit');
      requireChoice(action, RESOURCE_LIMITS);
      if (!Number.isInteger(action.limit) || action.limit <= 0) {
        throw new Error('set-process-resource-limit requires a positive integer limit');
      }
      if (action.value === 'cpu-percent' && action.limit > 100) {
        throw new Error('CPU resource limit cannot exceed 100 percent');
      }
      if (action.value === 'memory-bytes' && (action.limit < MIN_RESOURCE_MEMORY_BYTES || action.limit > MAX_RESOURCE_MEMORY_BYTES)) {
        throw new Error('Memory resource limit is outside the bounded range');
      }
      break;
    case 'set-gpu-policy':
      requireKey(action, 'gpu.policy');
      requireChoice(action, GPU_POLICIES);
      break;
    case 'set-memory-policy':
      requireKey(action, 'memory.policy');
      requireChoice(action, MEMORY_POLICIES);
      break;
    case 'clear-cache':
      requireKey(action, 'cache');
      requireChoice(action, CACHE_TARGETS);
      break;
    case 'stop-approved-process':
      requireKey(action, 'process.stop');
      if (action.value !== 'background-approved') throw new Error('Process stop requires approved target class');
      break;
  }
  return { ...action };
}

/** Validate the structural part of a VQ plan before per-action handling. */
export function validateNativePlan(plan, { now = Date.now } = {}) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('Native optimizer plan must be an object');
  }
  if (plan.protocolVersion !== NATIVE_PROTOCOL_VERSION) {
    throw new Error(`Native plan protocol mismatch: expected ${NATIVE_PROTOCOL_VERSION}`);
  }
  if (!Array.isArray(plan.actions) || plan.actions.length > MAX_NATIVE_ACTIONS) {
    throw new Error(`Native plan must contain at most ${MAX_NATIVE_ACTIONS} actions`);
  }
  if (typeof plan.planId !== 'string' || plan.planId.length === 0 || plan.planId.length > 128) {
    throw new Error('Native plan requires a short planId');
  }
  if (typeof plan.expiresAt !== 'string') throw new Error('Native plan requires expiresAt');
  const expiresAtMs = Date.parse(plan.expiresAt);
  if (!Number.isFinite(expiresAtMs) || new Date(expiresAtMs).toISOString() !== plan.expiresAt) {
    throw new Error('Native plan expiresAt must be a canonical ISO timestamp');
  }
  const nowMs = now();
  if (!Number.isFinite(nowMs)) throw new Error('Native plan clock is invalid');
  if (expiresAtMs <= nowMs) throw new Error('Native plan expired');
  if (expiresAtMs - nowMs > MAX_NATIVE_PLAN_TTL_MS) {
    throw new Error(`Native plan expiresAt exceeds ${MAX_NATIVE_PLAN_TTL_MS}ms maximum TTL`);
  }
  return { ...plan, actions: plan.actions.slice() };
}

export function isDestructiveNativeAction(action) {
  return DESTRUCTIVE_ACTIONS.includes(action?.type);
}
