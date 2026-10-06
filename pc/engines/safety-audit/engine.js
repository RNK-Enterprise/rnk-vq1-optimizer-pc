/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Safety-audit engine. It classifies proposed action boundaries without
 * executing actions, changing files, or opening transport.
 */

export const SAFETY_AUDIT_ENGINE_ID = 'safety-audit';
export const SAFETY_AUDIT_ENGINE_VERSION = 1;
export const SAFETY_AUDIT_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Safety-audit facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Safety-audit requires system-facts facts');
  if (!isRecord(facts.audit)) throw new TypeError('Safety-audit facts require an audit object');
  return facts;
}

function requireTrigger(trigger) {
  if (!SAFETY_AUDIT_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported safety-audit trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Safety-audit clock must return a number');
  return timestamp;
}

function operatingState(environment, actionCount, destructiveCount, approval, adminRequired) {
  if (environment === 'unknown') return 'profile-required';
  if (actionCount === 0) return 'no-actions';
  if (destructiveCount > 0) return 'unsafe-proposal';
  if (approval !== true) return 'approval-required';
  if (adminRequired === true) return 'admin-review';
  return 'reviewed';
}

function recommendations(environment, actionCount, destructiveCount, approval, adminRequired) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (actionCount === 0) return Object.freeze(['no-action-review']);
  if (destructiveCount > 0) return Object.freeze(['reject-destructive-proposal']);
  if (approval !== true) return Object.freeze(['request-explicit-user-approval']);
  if (adminRequired === true) return Object.freeze(['show-admin-required-boundary']);
  return Object.freeze(['permit-review-only']);
}

function confidence(environment, actionCount, destructiveCount, approval, adminRequired) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (actionCount !== null) score += 0.2;
  if (destructiveCount !== null) score += 0.2;
  if (approval !== null) score += 0.2;
  if (adminRequired !== null) score += 0.2;
  return Math.round(score * 10000) / 10000;
}

export function runSafetyAuditEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const audit = source.audit;
  const actionCount = nonNegative(audit.actionCount);
  const destructiveCount = nonNegative(audit.destructiveCount);
  const approval = booleanOrNull(audit.userApproval);
  const adminRequired = booleanOrNull(audit.adminRequired);
  const fileMutation = booleanOrNull(audit.fileMutation);
  const networkMutation = booleanOrNull(audit.networkMutation);
  return Object.freeze({
    protocolVersion: 1,
    engine: SAFETY_AUDIT_ENGINE_ID,
    engineVersion: SAFETY_AUDIT_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    actionCount,
    destructiveCount,
    userApproval: approval,
    adminRequired,
    fileMutation,
    networkMutation,
    state: operatingState(environment, actionCount, destructiveCount, approval, adminRequired),
    confidence: confidence(environment, actionCount, destructiveCount, approval, adminRequired),
    recommendations: recommendations(environment, actionCount, destructiveCount, approval, adminRequired),
    actions: EMPTY_ARRAY
  });
}
