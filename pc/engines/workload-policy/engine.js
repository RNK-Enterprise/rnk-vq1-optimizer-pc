/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Workload-policy engine. It converts observed developer and gaming context
 * into a bounded resource plan. It never changes process, power, or file
 * state; an approved native capability is required for any future action.
 */

export const WORKLOAD_POLICY_ENGINE_ID = 'workload-policy';
export const WORKLOAD_POLICY_ENGINE_VERSION = 1;
export const WORKLOAD_POLICY_TRIGGERS = Object.freeze([
  'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
]);

const MODES = Object.freeze(['developer', 'gaming', 'gaming-build', 'idle', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
const MODE_RECOMMENDATIONS = Object.freeze({
  'gaming-build': Object.freeze(['protect-game-foreground', 'apply-approved-background-budget', 'restore-on-game-exit']),
  gaming: Object.freeze(['protect-game-foreground', 'pause-nonessential-background-work', 'restore-on-game-exit']),
  developer: Object.freeze(['preserve-development-workload', 'review-resource-budget']),
  idle: Object.freeze(['observe-before-changing-workloads']),
  unknown: Object.freeze(['request-explicit-workload-mode'])
});

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function list(value, limit = 16) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim().toLowerCase()).slice(0, limit) : []; }
function boundedPercent(value) { return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null; }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function modeOf(value) { const normalized = text(value)?.toLowerCase(); return MODES.includes(normalized) ? normalized : null; }

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Workload-policy facts must be an object');
  if (!['system-facts', 'workload-policy-input'].includes(facts.engine)) throw new Error('Workload-policy requires system-facts or workload-policy-input facts');
  return facts;
}

function requireTrigger(trigger) {
  if (!WORKLOAD_POLICY_TRIGGERS.includes(trigger)) throw new Error(`Unsupported workload-policy trigger: ${trigger || 'unknown'}`);
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Workload-policy clock must return a number');
  return timestamp;
}

function workloadContext(source) {
  const workload = isRecord(source.workload) ? source.workload : {};
  const activeClasses = list(workload.activeClasses);
  const explicit = modeOf(source.mode ?? workload.mode);
  const gaming = activeClasses.includes('gaming') || explicit === 'gaming' || explicit === 'gaming-build';
  const developer = activeClasses.some((item) => ['build', 'development', 'ai', 'compiler'].includes(item)) || explicit === 'developer' || explicit === 'gaming-build';
  let mode = explicit;
  if (!mode) {
    if (gaming && developer) mode = 'gaming-build';
    else if (gaming) mode = 'gaming';
    else if (developer) mode = 'developer';
    else if (activeClasses.length) mode = 'idle';
    else mode = 'unknown';
  }
  return Object.freeze({
    mode,
    activeClasses,
    foregroundClass: text(workload.foregroundClass) || text(source.foregroundClass),
    latencySensitive: workload.latencySensitive === true || source.latencySensitive === true || gaming,
    protectedWorkloads: list(source.protectedWorkloads, 32)
  });
}

function budget(source, context) {
  let requested = {};
  if (isRecord(source.budget)) requested = source.budget;
  else if (isRecord(source.resourceBudget)) requested = source.resourceBudget;
  const normalized = Object.freeze({
    cpuPercent: boundedPercent(requested.cpuPercent),
    memoryBytes: nonNegative(requested.memoryBytes),
    ioBytesPerSecond: nonNegative(requested.ioBytesPerSecond),
    gpuPercent: boundedPercent(requested.gpuPercent)
  });
  const defaults = context.mode === 'gaming-build'
    ? { cpuPercent: 50, memoryBytes: 8 * 1024 ** 3, ioBytesPerSecond: 50 * 1024 ** 2, gpuPercent: 35 }
    : context.mode === 'gaming' ? { cpuPercent: 20, memoryBytes: 4 * 1024 ** 3, ioBytesPerSecond: 20 * 1024 ** 2, gpuPercent: 15 }
      : context.mode === 'developer' ? { cpuPercent: 85, memoryBytes: 8 * 1024 ** 3, ioBytesPerSecond: 100 * 1024 ** 2, gpuPercent: 60 }
        : { cpuPercent: null, memoryBytes: null, ioBytesPerSecond: null, gpuPercent: null };
  return Object.freeze({ requested: normalized, recommended: Object.freeze(defaults), source: Object.keys(requested).length ? 'user' : 'mode-default' });
}

function protection(context) {
  if (context.mode === 'gaming' || context.mode === 'gaming-build') return Object.freeze({ foreground: 'latency-sensitive', background: 'budgeted', restore: 'on-game-exit' });
  if (context.mode === 'developer') return Object.freeze({ foreground: 'user-workload', background: 'cooperative', restore: 'on-policy-end' });
  if (context.mode === 'idle') return Object.freeze({ foreground: 'unknown', background: 'observe', restore: 'on-policy-end' });
  return Object.freeze({ foreground: 'unknown', background: 'refuse-unbounded-control', restore: 'manual-review' });
}

function recommendations(context, factsComplete) {
  if (!factsComplete) return Object.freeze(['collect-workload-context']);
  return MODE_RECOMMENDATIONS[context.mode];
}

export function runWorkloadPolicyEngine(facts, { trigger, now = Date.now } = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const context = workloadContext(source);
  const planReady = context.mode !== 'unknown' && Boolean(context.foregroundClass || context.activeClasses.length);
  const budgets = budget(source, context);
  return Object.freeze({
    protocolVersion: 1, engine: WORKLOAD_POLICY_ENGINE_ID, engineVersion: WORKLOAD_POLICY_ENGINE_VERSION,
    trigger, generatedAt: new Date(timestamp).toISOString(), mode: context.mode,
    activeClasses: context.activeClasses, foregroundClass: context.foregroundClass,
    latencySensitive: context.latencySensitive, protectedWorkloads: context.protectedWorkloads,
    state: planReady ? 'plan-ready' : 'observation-required', budget: budgets,
    foregroundProtection: protection(context), recommendations: recommendations(context, planReady), actions: EMPTY_ARRAY
  });
}
