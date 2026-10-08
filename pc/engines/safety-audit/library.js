/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Safety-audit library. It classifies proposed action boundaries without
 * executing actions, changing files, or opening transport.
 */

export const SAFETY_AUDIT_LIBRARY_ID = 'safety-audit-library';
export const SAFETY_AUDIT_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

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
  if (!isRecord(facts)) throw new TypeError('Safety-audit library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Safety-audit library requires normalized system facts');
  }
  if (!isRecord(facts.audit)) throw new TypeError('Safety-audit library requires an audit object');
  return facts;
}

function stateFor(environment, actionCount, destructiveCount, approval, adminRequired) {
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

export function classifySafetyAudit(facts) {
  const source = requireFacts(facts);
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const audit = source.audit;
  const actionCount = nonNegative(audit.actionCount);
  const destructiveCount = nonNegative(audit.destructiveCount);
  const approval = booleanOrNull(audit.userApproval);
  const adminRequired = booleanOrNull(audit.adminRequired);
  const fileMutation = booleanOrNull(audit.fileMutation);
  const networkMutation = booleanOrNull(audit.networkMutation);
  return Object.freeze({
    library: SAFETY_AUDIT_LIBRARY_ID,
    libraryVersion: SAFETY_AUDIT_LIBRARY_VERSION,
    environment,
    actionCount,
    destructiveCount,
    userApproval: approval,
    adminRequired,
    fileMutation,
    networkMutation,
    state: stateFor(environment, actionCount, destructiveCount, approval, adminRequired),
    confidence: confidence(environment, actionCount, destructiveCount, approval, adminRequired),
    recommendations: recommendations(environment, actionCount, destructiveCount, approval, adminRequired)
  });
}

export function compareSafetyAudit(previous, current) {
  const before = classifySafetyAudit(previous);
  const after = classifySafetyAudit(current);
  const stateChanged = before.state !== after.state;
  const actionChanged = before.actionCount !== after.actionCount;
  const destructiveChanged = before.destructiveCount !== after.destructiveCount;
  const approvalChanged = before.userApproval !== after.userApproval;
  const adminChanged = before.adminRequired !== after.adminRequired;
  const fileMutationChanged = before.fileMutation !== after.fileMutation;
  const networkMutationChanged = before.networkMutation !== after.networkMutation;
  return Object.freeze({
    changed: stateChanged || actionChanged || destructiveChanged || approvalChanged || adminChanged
      || fileMutationChanged || networkMutationChanged,
    stateChanged,
    actionChanged,
    destructiveChanged,
    approvalChanged,
    adminChanged,
    fileMutationChanged,
    networkMutationChanged
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Safety-audit library clock must return a number');
  return timestamp;
}

export function buildSafetyAuditEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Safety-audit library trigger is required');
  }
  return Object.freeze({
    library: SAFETY_AUDIT_LIBRARY_ID,
    libraryVersion: SAFETY_AUDIT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifySafetyAudit(facts)
  });
}

export function createSafetyAuditLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Safety-audit library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: SAFETY_AUDIT_LIBRARY_ID,
    version: SAFETY_AUDIT_LIBRARY_VERSION,
    classify: classifySafetyAudit,
    compare: compareSafetyAudit,
    envelope: (facts, envelopeOptions = {}) => buildSafetyAuditEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
