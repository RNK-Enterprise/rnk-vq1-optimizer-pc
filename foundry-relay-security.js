/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Foundry relay security primitives. These functions accept only bounded data;
 * they never execute code, resolve setting paths, or retain client content.
 */

import { randomBytes } from 'crypto';
import {
  DEFAULT_LIMITS,
  PROTOCOL_VERSION,
  validateAction
} from './scripts/vq/protocol.js';

export const RELAY_ACTION_LIMIT = 24;
export const RELAY_TELEMETRY_LIMIT = 16 * 1024;
export const RELAY_PLAN_TTL_MS = 30_000;

const PROFILES = new Set(['power', 'balanced', 'performance', 'low-latency', 'battery-mobile']);
const SCOPES = new Set(['self', 'all', 'selected']);
const COMPONENT_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ACTION_KEYS = Object.freeze({
  'set-quality': new Set(['render.distance', 'render.resolution']),
  'set-cache-size': new Set(['cache.size']),
  'set-batch-size': new Set(['batch.size']),
  'set-fps-cap': new Set(['fps.cap']),
  'set-effect-budget': new Set(['effects.budget']),
  'set-animation-budget': new Set(['animation.budget']),
  'set-network-batch': new Set(['network.batch'])
});
const EMPTY = Object.freeze([]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value, min, max) {
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function booleanValue(value) {
  return value === true;
}

function stringValue(value, allowed) {
  if (typeof value !== 'string' || value.length > 64) return null;
  return allowed && !allowed.has(value) ? null : value;
}

function pickNumbers(source, keys, max) {
  return Object.fromEntries(keys.map((key) => [key, finiteNumber(source?.[key], 0, max)]));
}

/** Keep only the documented PerformanceTelemetry shape. */
export function sanitizeTelemetry(value, { maxBytes = RELAY_TELEMETRY_LIMIT } = {}) {
  if (!isRecord(value)) return {};
  const fps = isRecord(value.fps) ? pickNumbers(value.fps, ['average', 'low1Percent', 'frameTimeMs', 'varianceMs'], 10000) : {};
  const memory = isRecord(value.memory) ? pickNumbers(value.memory, ['usedMB', 'limitMB'], 1024 * 1024) : {};
  const network = isRecord(value.network) ? {
    latencyMs: finiteNumber(value.network.latencyMs, 0, 600000),
    jitterMs: finiteNumber(value.network.jitterMs, 0, 600000),
    effectiveType: stringValue(value.network.effectiveType, new Set(['slow-2g', '2g', '3g', '4g'])),
    saveData: booleanValue(value.network.saveData)
  } : {};
  const workload = isRecord(value.workload) ? pickNumbers(value.workload, ['longTasks', 'activeEffects', 'activeAnimations', 'pendingTasks', 'tickerFPS'], 1000000) : {};
  const runtime = isRecord(value.runtime) ? {
    mobile: booleanValue(value.runtime.mobile),
    cores: finiteNumber(value.runtime.cores, 0, 4096),
    deviceMemoryGB: finiteNumber(value.runtime.deviceMemoryGB, 0, 4096),
    webgpu: booleanValue(value.runtime.webgpu),
    wasm: booleanValue(value.runtime.wasm)
  } : {};
  const result = { fps, memory, network, workload, runtime };
  return JSON.stringify(result).length > maxBytes ? { truncated: true } : result;
}

function normalizedPlanId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}

function safeAction(action, limits) {
  const validated = validateAction(action, limits);
  if (ACTION_KEYS[validated.type] && !ACTION_KEYS[validated.type].has(validated.key)) {
    throw new Error(`Action key is not allowed for ${validated.type}`);
  }
  if (['enable-component', 'disable-component'].includes(validated.type)
    && (typeof validated.key !== 'string' || !COMPONENT_KEY.test(validated.key))) {
    throw new Error('Component key is not allowed');
  }
  if (Object.keys(validated).some((key) => !['type', 'key', 'value'].includes(key))) {
    throw new Error('Optimizer actions cannot contain extra fields');
  }
  return Object.fromEntries(Object.entries(validated).filter(([key]) => ['type', 'key', 'value'].includes(key)));
}

/** Validate and reduce a VQ plan before it reaches any Foundry client. */
export function validateRelayPlan(plan, {
  now = Date.now,
  request = {},
  limits = DEFAULT_LIMITS,
  maxTtlMs = RELAY_PLAN_TTL_MS
} = {}) {
  if (!isRecord(plan) || plan.protocolVersion !== PROTOCOL_VERSION) throw new Error('VQ plan protocol mismatch');
  if (!PROFILES.has(plan.profile || request.profile)) throw new Error('VQ plan profile is invalid');
  if (!SCOPES.has(plan.scope || request.scope)) throw new Error('VQ plan scope is invalid');
  if (!Array.isArray(plan.actions) || plan.actions.length > RELAY_ACTION_LIMIT) throw new Error(`VQ plan must contain 0-${RELAY_ACTION_LIMIT} actions`);
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Relay clock must return a number');
  const expiresAt = typeof plan.expiresAt === 'string'
    ? Date.parse(plan.expiresAt)
    : timestamp + maxTtlMs;
  if (!Number.isFinite(expiresAt) || expiresAt <= timestamp || expiresAt > timestamp + maxTtlMs) {
    throw new Error('VQ plan expiration is invalid');
  }
  const actions = plan.actions.map((action) => safeAction(action, limits));
  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    planId: normalizedPlanId(plan.planId) || `relay-${randomBytes(16).toString('hex')}`,
    profile: plan.profile || request.profile,
    scope: plan.scope || request.scope,
    targetClientIds: Array.isArray(request.targetClientIds) ? request.targetClientIds.slice(0, 128) : EMPTY,
    expiresAt: new Date(expiresAt).toISOString(),
    actions: Object.freeze(actions),
    recommendations: Object.freeze(Array.isArray(plan.recommendations)
      ? plan.recommendations.filter((item) => typeof item === 'string').slice(0, 32)
      : EMPTY),
    sourceUnits: Object.freeze(Array.isArray(plan.sourceUnits)
      ? plan.sourceUnits.filter((item) => typeof item === 'string').slice(0, 8)
      : EMPTY)
  });
}

export function createOpaqueClientId() {
  return `client_${randomBytes(18).toString('base64url')}`;
}

export class RelayRateLimiter {
  constructor({ now = Date.now, windowMs = 60_000, maxRequests = 60 } = {}) {
    if (typeof now !== 'function') throw new TypeError('Rate limiter clock must be a function');
    if (!Number.isInteger(windowMs) || windowMs < 1000) throw new RangeError('Rate limiter window is invalid');
    if (!Number.isInteger(maxRequests) || maxRequests < 1) throw new RangeError('Rate limiter maximum is invalid');
    this.now = now;
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.entries = new Map();
  }

  check(key) {
    const current = this.now();
    const previous = this.entries.get(key);
    const entry = !previous || current - previous.startedAt >= this.windowMs
      ? { startedAt: current, count: 0 }
      : previous;
    entry.count++;
    this.entries.set(key, entry);
    const allowed = entry.count <= this.maxRequests;
    return { allowed, remaining: Math.max(0, this.maxRequests - entry.count), retryAfterMs: Math.max(0, this.windowMs - (current - entry.startedAt)) };
  }
}

export class RelayReplayGuard {
  constructor({ now = Date.now, maxEntries = 512 } = {}) {
    if (typeof now !== 'function') throw new TypeError('Replay guard clock must be a function');
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('Replay guard maximum is invalid');
    this.now = now;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  issue(plan, clientId) {
    this.prune();
    this.entries.set(plan.planId, {
      expiresAt: Date.parse(plan.expiresAt),
      clientId,
      scope: plan.scope,
      actionCount: plan.actions.length,
      used: false
    });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  consume(planId, clientId, { scope, actionCount } = {}) {
    this.prune();
    const entry = this.entries.get(planId);
    if (!entry) throw new Error('Unknown or expired plan ID');
    if (entry.used) throw new Error('Plan ID has already been used');
    if (entry.clientId !== clientId) throw new Error('Plan ID does not belong to this client');
    if (scope !== undefined && entry.scope !== scope) throw new Error('Plan scope does not match');
    if (actionCount !== undefined && entry.actionCount !== actionCount) throw new Error('Plan action count does not match');
    entry.used = true;
    return true;
  }

  prune() {
    const current = this.now();
    for (const [planId, entry] of this.entries) if (entry.expiresAt <= current) this.entries.delete(planId);
  }
}

export class RelayAuditLog {
  constructor({ maxEntries = 2048 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('Audit maximum is invalid');
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  append(entry) {
    this.entries.push(Object.freeze({ ...entry }));
    if (this.entries.length > this.maxEntries) this.entries.shift();
  }

  list() {
    return this.entries.map((entry) => ({ ...entry }));
  }
}
