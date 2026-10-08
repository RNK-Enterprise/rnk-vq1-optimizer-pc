/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Foreground-protection turbo. It verifies that a declared game foreground
 * workload has an identified latency-sensitive process before any plan exists.
 */

export const WORKLOAD_POLICY_FOREGROUND_PROTECTION_TURBO_ID = 'workload-policy.foreground-protection';
export const WORKLOAD_POLICY_FOREGROUND_PROTECTION_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['system.facts.request', 'workload.changed', 'health.interval']);
function modeOf(sample) { if (sample && sample.mode) return sample.mode; return sample?.workload?.mode || 'unknown'; }
function foregroundOf(sample) { const direct = sample?.foregroundClass; if (typeof direct === 'string' && direct.trim()) return direct.trim(); const nested = sample?.workload?.foregroundClass; if (typeof nested === 'string' && nested.trim()) return nested.trim(); return null; }
function requireTrigger(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported workload-policy foreground-protection trigger: ${trigger || 'unknown'}`); return trigger; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workload-policy foreground-protection clock must return a number'); return timestamp; }
export function runWorkloadPolicyForegroundProtectionTurbo(samples = [], { trigger, now = Date.now } = {}) { requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Workload-policy foreground-protection samples must be an array'); const timestamp = requireClock(now); const selected = samples.slice(-64); const gaming = selected.filter((sample) => ['gaming', 'gaming-build'].includes(modeOf(sample))); const protectedCount = gaming.filter((sample) => foregroundOf(sample)).length; const state = !selected.length ? 'insufficient-data' : gaming.length === 0 ? 'not-applicable' : protectedCount === gaming.length ? 'foreground-protected' : 'observation-required'; const recommendations = state === 'foreground-protected' ? ['preserve-game-foreground'] : state === 'not-applicable' ? ['no-change'] : state === 'insufficient-data' ? ['collect-foreground-context'] : ['identify-game-foreground']; return Object.freeze({ protocolVersion: 1, turbo: WORKLOAD_POLICY_FOREGROUND_PROTECTION_TURBO_ID, turboVersion: WORKLOAD_POLICY_FOREGROUND_PROTECTION_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, gamingCount: gaming.length, protectedCount, state, recommendations: Object.freeze(recommendations), actions: Object.freeze([]) }); }
