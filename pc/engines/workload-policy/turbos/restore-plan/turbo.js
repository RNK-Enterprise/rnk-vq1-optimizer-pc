/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Restore-plan turbo. It records when a gaming policy must be restored after
 * the foreground game exits; it never performs the restoration.
 */

export const WORKLOAD_POLICY_RESTORE_PLAN_TURBO_ID = 'workload-policy.restore-plan';
export const WORKLOAD_POLICY_RESTORE_PLAN_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['system.facts.request', 'workload.changed', 'health.interval']);
function modeOf(sample) { return sample?.mode || sample?.workload?.mode || 'unknown'; }
function requireTrigger(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported workload-policy restore-plan trigger: ${trigger || 'unknown'}`); return trigger; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workload-policy restore-plan clock must return a number'); return timestamp; }
export function runWorkloadPolicyRestorePlanTurbo(samples = [], { trigger, now = Date.now } = {}) { requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Workload-policy restore-plan samples must be an array'); const timestamp = requireClock(now); const selected = samples.slice(-64); const gamingCount = selected.filter((sample) => ['gaming', 'gaming-build'].includes(modeOf(sample))).length; const unknownCount = selected.filter((sample) => modeOf(sample) === 'unknown').length; const state = !selected.length ? 'insufficient-data' : gamingCount ? 'restore-planned' : unknownCount ? 'observation-required' : 'no-restore-needed'; const restoreActions = gamingCount ? ['restore-background-budget', 'restore-power-policy', 'verify-foreground-exit'] : []; const recommendations = state === 'restore-planned' ? ['restore-after-game-exit'] : state === 'observation-required' ? ['collect-workload-mode'] : state === 'insufficient-data' ? ['collect-restore-context'] : ['no-change']; return Object.freeze({ protocolVersion: 1, turbo: WORKLOAD_POLICY_RESTORE_PLAN_TURBO_ID, turboVersion: WORKLOAD_POLICY_RESTORE_PLAN_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, gamingCount, state, restoreActions: Object.freeze(restoreActions), recommendations: Object.freeze(recommendations), actions: Object.freeze([]) }); }
