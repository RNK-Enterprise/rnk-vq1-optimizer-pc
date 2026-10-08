/**
 * Native optimizer protocol tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import {
  DESTRUCTIVE_ACTIONS,
  MAX_NATIVE_ACTIONS,
  MAX_NATIVE_PLAN_TTL_MS,
  NATIVE_PROTOCOL_VERSION,
  isDestructiveNativeAction,
  validateNativeAction,
  validateNativePlan
} from '../native/protocol.js';

const actions = [
  ['set-power-profile', 'power.profile', 'balanced'],
  ['set-process-priority', 'process.priority', 'high'],
  ['set-process-io-priority', 'process.io', 'low'],
  ['set-process-affinity', 'process.affinity', 'performance'],
  ['set-process-resource-limit', 'process.resource-limit', 'cpu-percent'],
  ['set-gpu-policy', 'gpu.policy', 'battery'],
  ['set-memory-policy', 'memory.policy', 'background-low'],
  ['clear-cache', 'cache', 'user-temp'],
  ['stop-approved-process', 'process.stop', 'background-approved']
];
const VALID_NOW = Date.parse('2029-01-01T00:00:00.000Z');
const VALID_EXPIRY = new Date(VALID_NOW + 60 * 1000).toISOString();

describe('native protocol', () => {
  test('validates every bounded action shape and returns a copy', () => {
    for (const [type, key, value] of actions) {
      const input = { type, key, value, ...(type === 'set-process-resource-limit' ? { limit: 50 } : {}) };
      expect(validateNativeAction(input)).toEqual(input);
      expect(validateNativeAction(input)).not.toBe(input);
    }
    expect(DESTRUCTIVE_ACTIONS).toEqual(['clear-cache', 'stop-approved-process']);
    expect(isDestructiveNativeAction({ type: 'clear-cache' })).toBe(true);
    expect(isDestructiveNativeAction({ type: 'set-gpu-policy' })).toBe(false);
    expect(isDestructiveNativeAction(null)).toBe(false);
  });

  test('rejects malformed actions, commands, paths, and values', () => {
    expect(() => validateNativeAction(null)).toThrow('must be an object');
    expect(() => validateNativeAction([])).toThrow('must be an object');
    expect(() => validateNativeAction({ type: 'not-real' })).toThrow('Unsupported');
    expect(() => validateNativeAction({})).toThrow('unknown');
    expect(() => validateNativeAction({ type: 'clear-cache', key: 'cache', value: 'user-temp', command: 'rm' })).toThrow('commands');
    expect(() => validateNativeAction({ type: 'clear-cache', key: 'wrong', value: 'user-temp' })).toThrow('requires key');
    expect(() => validateNativeAction({ type: 'clear-cache', key: 'cache', value: 'files' })).toThrow('unsupported value');
    expect(() => validateNativeAction({ type: 'stop-approved-process', key: 'process.stop', value: 'any' })).toThrow('approved target');
    expect(() => validateNativeAction({ type: 'set-process-priority', key: 'process.priority', value: 'realtime' })).toThrow('unsupported value');
    expect(() => validateNativeAction({ type: 'set-process-resource-limit', key: 'process.resource-limit', value: 'cpu-percent', limit: 0 })).toThrow('positive integer');
    expect(() => validateNativeAction({ type: 'set-process-resource-limit', key: 'process.resource-limit', value: 'cpu-percent', limit: 101 })).toThrow('100 percent');
    expect(() => validateNativeAction({ type: 'set-process-resource-limit', key: 'process.resource-limit', value: 'memory-bytes', limit: 1.5 })).toThrow('positive integer');
    expect(() => validateNativeAction({ type: 'set-process-resource-limit', key: 'process.resource-limit', value: 'memory-bytes', limit: 1 })).toThrow('bounded range');
    expect(() => validateNativeAction({ type: 'set-process-resource-limit', key: 'process.resource-limit', value: 'memory-bytes', limit: 2 ** 41 })).toThrow('bounded range');
  });

  test('validates bounded plans and expiry', () => {
    const plan = {
      protocolVersion: NATIVE_PROTOCOL_VERSION,
      planId: 'plan-1',
      expiresAt: VALID_EXPIRY,
      actions: [{ type: 'set-power-profile', key: 'power.profile', value: 'balanced' }]
    };
    expect(validateNativePlan(plan, { now: () => VALID_NOW })).toEqual(plan);
    expect(() => validateNativePlan({ ...plan, expiresAt: undefined }, { now: () => VALID_NOW })).toThrow('requires expiresAt');
    expect(() => validateNativePlan({ ...plan, expiresAt: 'not-a-date' }, { now: () => VALID_NOW })).toThrow('canonical ISO');
    expect(() => validateNativePlan({ ...plan, expiresAt: new Date(VALID_NOW + MAX_NATIVE_PLAN_TTL_MS + 1).toISOString() }, { now: () => VALID_NOW })).toThrow('maximum TTL');
    expect(() => validateNativePlan(plan, { now: () => Number.NaN })).toThrow('clock is invalid');
    expect(() => validateNativePlan(null)).toThrow('must be an object');
    expect(() => validateNativePlan({ ...plan, protocolVersion: 2 })).toThrow('protocol mismatch');
    expect(() => validateNativePlan({ ...plan, actions: 'nope' })).toThrow('at most');
    expect(() => validateNativePlan({ ...plan, actions: Array(MAX_NATIVE_ACTIONS + 1).fill({}) })).toThrow('at most');
    expect(() => validateNativePlan({ ...plan, planId: '' })).toThrow('short planId');
    expect(() => validateNativePlan({ ...plan, planId: 'x'.repeat(129) })).toThrow('short planId');
    expect(() => validateNativePlan({ ...plan, expiresAt: '2000-01-01T00:00:00.000Z' }, { now: () => VALID_NOW })).toThrow('expired');
  });
});
