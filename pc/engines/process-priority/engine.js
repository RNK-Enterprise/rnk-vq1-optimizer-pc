/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Process-priority engine. It classifies documented process priority labels
 * without changing priorities, processes, files, or transport state.
 */

export const PROCESS_PRIORITY_ENGINE_ID = 'process-priority';
export const PROCESS_PRIORITY_ENGINE_VERSION = 1;
export const PROCESS_PRIORITY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const PRIORITIES = Object.freeze(['idle', 'below-normal', 'normal', 'above-normal', 'high', 'realtime']);
const ELEVATED = Object.freeze(['above-normal', 'high', 'realtime']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function priorityClass(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
  const normalized = value.trim().toLowerCase();
  return PRIORITIES.includes(normalized) ? normalized : 'unknown';
}

function processName(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Process-priority facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Process-priority requires system-facts facts');
  if (!Array.isArray(facts.processes)) throw new TypeError('Process-priority facts require a process list');
  return facts;
}

function requireTrigger(trigger) {
  if (!PROCESS_PRIORITY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported process-priority trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Process-priority clock must return a number');
  return timestamp;
}

function operatingState(environment, count, unknownCount, elevatedCount) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-processes';
  if (unknownCount > 0) return 'observation-required';
  if (elevatedCount > 0) return 'review-elevated';
  return 'observe';
}

function recommendations(environment, count, unknownCount, elevatedCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-process-priority-review']);
  if (unknownCount > 0) return Object.freeze(['request-documented-priority-observation']);
  if (elevatedCount > 0) return Object.freeze(['review-user-owned-priority-choices']);
  return Object.freeze(['no-change']);
}

function confidence(environment, count, unknownCount) {
  let score = 0;
  if (environment !== 'unknown') score += 0.25;
  if (count > 0) score += 0.25;
  if (count > 0 && unknownCount === 0) score += 0.5;
  return Math.round(score * 10000) / 10000;
}

export function runProcessPriorityEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const processes = source.processes.filter(isRecord).map((process) => ({
    name: processName(process.name),
    priority: priorityClass(process.priority),
    foreground: process.foreground === true,
    protected: process.protected === true
  }));
  const unknownCount = processes.filter((process) => process.priority === 'unknown').length;
  const elevatedCount = processes.filter((process) => ELEVATED.includes(process.priority)).length;
  const state = operatingState(environment, processes.length, unknownCount, elevatedCount);
  return Object.freeze({
    protocolVersion: 1,
    engine: PROCESS_PRIORITY_ENGINE_ID,
    engineVersion: PROCESS_PRIORITY_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    processCount: processes.length,
    names: Object.freeze(processes.map((process) => process.name).filter(Boolean)),
    priorities: Object.freeze(processes.map((process) => process.priority)),
    foregroundCount: processes.filter((process) => process.foreground).length,
    protectedCount: processes.filter((process) => process.protected).length,
    unknownPriorityCount: unknownCount,
    elevatedPriorityCount: elevatedCount,
    state,
    confidence: confidence(environment, processes.length, unknownCount),
    recommendations: recommendations(environment, processes.length, unknownCount, elevatedCount),
    actions: EMPTY_ARRAY
  });
}
