/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Resource-budget turbo. It compares declared budgets with safe requested
 * values and reports violations without applying limits to a process.
 */

export const WORKLOAD_POLICY_RESOURCE_BUDGET_TURBO_ID = 'workload-policy.resource-budget';
export const WORKLOAD_POLICY_RESOURCE_BUDGET_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['system.facts.request', 'workload.changed', 'health.interval']);
const FIELDS = Object.freeze(['cpuPercent', 'memoryBytes', 'ioBytesPerSecond', 'gpuPercent']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function budgetOf(sample) { return isRecord(sample?.budget) ? sample.budget : {}; }
function violations(sample) { const budget = budgetOf(sample); const requested = budget.requested || {}; const limit = budget.recommended || {}; return FIELDS.filter((field) => Number.isFinite(requested[field]) && Number.isFinite(limit[field]) && requested[field] > limit[field]); }
function requireTrigger(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported workload-policy resource-budget trigger: ${trigger || 'unknown'}`); return trigger; }
function requireWindow(value) { if (!Number.isInteger(value) || value < 1 || value > 64) throw new RangeError('Workload-policy resource-budget windowSize must be from 1 to 64'); return value; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workload-policy resource-budget clock must return a number'); return timestamp; }
export function runWorkloadPolicyResourceBudgetTurbo(samples = [], { trigger, windowSize = 16, now = Date.now } = {}) { requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Workload-policy resource-budget samples must be an array'); const selected = samples.slice(-requireWindow(windowSize)); const timestamp = requireClock(now); const observed = selected.filter((sample) => FIELDS.some((field) => Number.isFinite(budgetOf(sample).requested?.[field]) && Number.isFinite(budgetOf(sample).recommended?.[field]))); const allViolations = [...new Set(selected.flatMap(violations))]; const state = !selected.length ? 'insufficient-data' : !observed.length ? 'observation-required' : allViolations.length ? 'budget-exceeded' : 'within-budget'; const recommendations = state === 'budget-exceeded' ? ['review-resource-budget'] : state === 'observation-required' ? ['collect-resource-budget'] : state === 'insufficient-data' ? ['collect-resource-budget'] : ['no-change']; return Object.freeze({ protocolVersion: 1, turbo: WORKLOAD_POLICY_RESOURCE_BUDGET_TURBO_ID, turboVersion: WORKLOAD_POLICY_RESOURCE_BUDGET_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, observedCount: observed.length, violations: Object.freeze(allViolations), state, recommendations: Object.freeze(recommendations), actions: Object.freeze([]) }); }
