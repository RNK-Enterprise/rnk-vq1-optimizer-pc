/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Process-priority library. It classifies documented labels for review and
 * never renices, suspends, terminates, or otherwise changes a process.
 */

export const PROCESS_PRIORITY_LIBRARY_ID = 'process-priority-library';
export const PROCESS_PRIORITY_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const PRIORITIES = Object.freeze(['idle', 'below-normal', 'normal', 'above-normal', 'high', 'realtime']);
const ELEVATED = Object.freeze(['above-normal', 'high', 'realtime']);

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
  if (!isRecord(facts)) throw new TypeError('Process-priority library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Process-priority library requires normalized system facts');
  }
  if (!Array.isArray(facts.processes)) {
    throw new TypeError('Process-priority library requires a process list');
  }
  return facts;
}

function recommendations(environment, count, unknownCount, elevatedCount) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-process-priority-review']);
  if (unknownCount > 0) return Object.freeze(['request-documented-priority-observation']);
  if (elevatedCount > 0) return Object.freeze(['review-user-owned-priority-choices']);
  return Object.freeze(['no-change']);
}

export function classifyProcessPriority(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const processes = source.processes.filter(isRecord).map((process) => ({
    name: processName(process.name),
    priority: priorityClass(process.priority),
    foreground: process.foreground === true,
    protected: process.protected === true
  }));
  const unknownCount = processes.filter((process) => process.priority === 'unknown').length;
  const elevatedCount = processes.filter((process) => ELEVATED.includes(process.priority)).length;
  return Object.freeze({
    library: PROCESS_PRIORITY_LIBRARY_ID,
    libraryVersion: PROCESS_PRIORITY_LIBRARY_VERSION,
    environment,
    processCount: processes.length,
    names: Object.freeze(processes.map((process) => process.name).filter(Boolean)),
    priorities: Object.freeze(processes.map((process) => process.priority)),
    foregroundCount: processes.filter((process) => process.foreground).length,
    protectedCount: processes.filter((process) => process.protected).length,
    unknownPriorityCount: unknownCount,
    elevatedPriorityCount: elevatedCount,
    recommendations: recommendations(environment, processes.length, unknownCount, elevatedCount)
  });
}

export function compareProcessPriority(previous, current) {
  const before = classifyProcessPriority(previous);
  const after = classifyProcessPriority(current);
  const countChanged = before.processCount !== after.processCount;
  const unknownChanged = before.unknownPriorityCount !== after.unknownPriorityCount;
  const elevatedChanged = before.elevatedPriorityCount !== after.elevatedPriorityCount;
  return Object.freeze({
    changed: countChanged || unknownChanged || elevatedChanged,
    countChanged,
    unknownChanged,
    elevatedChanged,
    foregroundChanged: before.foregroundCount !== after.foregroundCount
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Process-priority library clock must return a number');
  return timestamp;
}

export function buildProcessPriorityEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Process-priority library trigger is required');
  }
  return Object.freeze({
    library: PROCESS_PRIORITY_LIBRARY_ID,
    libraryVersion: PROCESS_PRIORITY_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyProcessPriority(facts)
  });
}

export function createProcessPriorityLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Process-priority library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: PROCESS_PRIORITY_LIBRARY_ID,
    version: PROCESS_PRIORITY_LIBRARY_VERSION,
    classify: classifyProcessPriority,
    compare: compareProcessPriority,
    envelope: (facts, envelopeOptions = {}) => buildProcessPriorityEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
