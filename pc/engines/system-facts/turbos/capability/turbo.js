/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * System-facts capability turbo. It evaluates which observations and controls
 * are available for a normalized host profile. It never executes a control or
 * contacts another node.
 */

export const SYSTEM_FACTS_CAPABILITY_TURBO_ID = 'system-facts.capability';
export const SYSTEM_FACTS_CAPABILITY_TURBO_VERSION = 1;
export const SYSTEM_FACTS_CAPABILITY_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const STATUS = Object.freeze({
  supported: 1,
  'observation-only': 0.75,
  'admin-required': 0.5,
  unavailable: 0,
  'not-applicable': 1,
  unknown: 0.25
});
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Capability turbo snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Capability turbo requires a system-facts snapshot');
  if (!isRecord(snapshot.capabilities) || !isRecord(snapshot.cpu) || !isRecord(snapshot.memory)) {
    throw new TypeError('Capability turbo snapshot is missing normalized sections');
  }
  return snapshot;
}

function statusFor(value, { required = false, admin = false } = {}) {
  if (value === true) return 'supported';
  if (admin) return 'admin-required';
  if (required) return 'unavailable';
  return 'observation-only';
}

function gpuStatus(snapshot) {
  if (!Array.isArray(snapshot.gpus) || snapshot.gpus.length === 0) return 'unavailable';
  return snapshot.capabilities.gpuObservation === true ? 'observation-only' : 'unknown';
}

function displayStatus(snapshot) {
  if (snapshot.environment === 'headless') return 'not-applicable';
  if (snapshot.environment === 'unknown') return 'unknown';
  return statusFor(snapshot.capabilities.displayObservation, { required: true });
}

function batteryStatus(snapshot) {
  return statusFor(snapshot.capabilities.batteryObservation);
}

function rows(snapshot) {
  const facts = snapshot.capabilities;
  return Object.freeze([
    Object.freeze({ name: 'cpu-observation', status: 'supported', required: true }),
    Object.freeze({ name: 'memory-observation', status: 'supported', required: true }),
    Object.freeze({ name: 'swap-observation', status: snapshot.memory.swapTotalBytes === null ? 'unavailable' : 'supported', required: false }),
    Object.freeze({ name: 'gpu-observation', status: gpuStatus(snapshot), required: false }),
    Object.freeze({ name: 'display-observation', status: displayStatus(snapshot), required: snapshot.environment === 'interactive' }),
    Object.freeze({ name: 'battery-observation', status: batteryStatus(snapshot), required: false }),
    Object.freeze({ name: 'thermal-observation', status: statusFor(facts.thermalObservation), required: false }),
    Object.freeze({ name: 'power-profile-control', status: statusFor(facts.powerProfileControl, { admin: true }), required: false }),
    Object.freeze({ name: 'process-priority-control', status: statusFor(facts.processPriorityControl, { admin: true }), required: false }),
    Object.freeze({ name: 'io-priority-control', status: statusFor(facts.ioPriorityControl, { admin: true }), required: false }),
    Object.freeze({ name: 'cache-cleanup', status: statusFor(facts.cacheCleanup, { admin: true }), required: false }),
    Object.freeze({ name: 'network-observation', status: facts.networkObservation === false ? 'unavailable' : 'supported', required: false })
  ]);
}

function scoreRows(items) {
  return items.reduce((sum, item) => sum + STATUS[item.status], 0) / items.length;
}

function requiredFailures(items) {
  return items.filter((item) => item.required && item.status !== 'supported');
}

function statusSummary(items) {
  const summary = Object.fromEntries(Object.keys(STATUS).map((name) => [name, 0]));
  for (const item of items) summary[item.status] += 1;
  return Object.freeze(summary);
}

function namesWithStatus(items, statuses) {
  return Object.freeze(items
    .filter((item) => statuses.includes(item.status))
    .map((item) => item.name));
}

function readiness(score, failures) {
  if (failures.length > 0) return 'blocked';
  if (score >= 0.75) return 'ready';
  return 'partial';
}

function recommendations(snapshot, state, failures) {
  if (failures.length > 0) return Object.freeze(['resolve-required-capabilities']);
  if (snapshot.environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (state === 'partial') return Object.freeze(['keep-unsupported-controls-disabled']);
  return Object.freeze(['use-capability-selected-plan']);
}

function executionBoundary(snapshot, state) {
  if (snapshot.environment === 'unknown') return 'profile-selection-required';
  if (state === 'blocked') return 'manual-review-required';
  if (snapshot.environment === 'headless') return 'headless-safe-observation';
  return 'interactive-safe-observation';
}

function requireTrigger(trigger) {
  if (!SYSTEM_FACTS_CAPABILITY_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported capability turbo trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Capability turbo clock must return a number');
  return timestamp;
}

export function runCapabilityTurbo(snapshot, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const facts = requireSnapshot(snapshot);
  const timestamp = requireClock(now());
  const capabilityRows = rows(facts);
  const failures = requiredFailures(capabilityRows);
  const score = scoreRows(capabilityRows);
  const state = readiness(score, failures);
  const summary = statusSummary(capabilityRows);
  return Object.freeze({
    protocolVersion: 1,
    turbo: SYSTEM_FACTS_CAPABILITY_TURBO_ID,
    turboVersion: SYSTEM_FACTS_CAPABILITY_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment: facts.environment,
    score: Math.round(score * 10000) / 100,
    state,
    boundary: executionBoundary(facts, state),
    summary,
    capabilities: capabilityRows,
    requiredFailures: failures.map((item) => item.name),
    adminRequired: namesWithStatus(capabilityRows, ['admin-required']),
    unsupported: namesWithStatus(capabilityRows, ['unavailable', 'unknown']),
    recommendations: recommendations(facts, state, failures),
    actions: EMPTY_ARRAY
  });
}
