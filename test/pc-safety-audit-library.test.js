import {
  SAFETY_AUDIT_LIBRARY_ID,
  SAFETY_AUDIT_LIBRARY_VERSION,
  buildSafetyAuditEnvelope,
  classifySafetyAudit,
  compareSafetyAudit,
  createSafetyAuditLibrary
} from '../pc/engines/safety-audit/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    audit: {
      actionCount: 2, destructiveCount: 0, userApproval: true, adminRequired: false,
      fileMutation: false, networkMutation: false
    },
    ...overrides
  };
}

describe('Safety-audit library', () => {
  test('classifies reviewed and unsafe action boundaries', () => {
    expect(classifySafetyAudit(facts())).toMatchObject({
      library: SAFETY_AUDIT_LIBRARY_ID,
      libraryVersion: SAFETY_AUDIT_LIBRARY_VERSION,
      environment: 'interactive', actionCount: 2, destructiveCount: 0,
      userApproval: true, adminRequired: false, fileMutation: false, networkMutation: false,
      state: 'reviewed', confidence: 1, recommendations: ['permit-review-only']
    });
    expect(classifySafetyAudit(facts({ audit: {
      actionCount: 2, destructiveCount: 1, userApproval: true, adminRequired: false,
      fileMutation: true, networkMutation: true
    } }))).toMatchObject({ destructiveCount: 1, state: 'unsafe-proposal',
      recommendations: ['reject-destructive-proposal'] });
    expect(classifySafetyAudit(facts({ audit: {
      actionCount: 2, destructiveCount: 0, userApproval: false, adminRequired: false,
      fileMutation: false, networkMutation: false
    } }))).toMatchObject({ state: 'approval-required',
      recommendations: ['request-explicit-user-approval'] });
    expect(classifySafetyAudit(facts({ audit: {
      actionCount: 2, destructiveCount: 0, userApproval: true, adminRequired: true,
      fileMutation: false, networkMutation: false
    } }))).toMatchObject({ state: 'admin-review',
      recommendations: ['show-admin-required-boundary'] });
  });

  test('preserves no-action, unknown, and incomplete states', () => {
    expect(classifySafetyAudit(facts({ audit: {
      actionCount: 0, destructiveCount: 0, userApproval: null, adminRequired: null,
      fileMutation: null, networkMutation: null
    } }))).toMatchObject({ state: 'no-actions', confidence: 0.6,
      recommendations: ['no-action-review'] });
    expect(classifySafetyAudit(facts({ environment: 'other', audit: {
      actionCount: null, destructiveCount: null, userApproval: null, adminRequired: null
    } }))).toMatchObject({ environment: 'unknown', state: 'profile-required', confidence: 0,
      recommendations: ['request-environment-profile'] });
    expect(classifySafetyAudit(facts({ audit: {
      actionCount: 'bad', destructiveCount: -1, userApproval: 'yes', adminRequired: 1,
      fileMutation: true, networkMutation: false
    } }))).toMatchObject({ actionCount: null, destructiveCount: null, userApproval: null,
      adminRequired: null, fileMutation: true, networkMutation: false,
      state: 'approval-required', confidence: 0.2 });
  });

  test('compares audit samples and builds immutable local facades', () => {
    expect(compareSafetyAudit(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, actionChanged: false, destructiveChanged: false,
      approvalChanged: false, adminChanged: false, fileMutationChanged: false,
      networkMutationChanged: false
    });
    expect(compareSafetyAudit(facts(), facts({ audit: {
      actionCount: 3, destructiveCount: 1, userApproval: false, adminRequired: true,
      fileMutation: true, networkMutation: true
    } }))).toMatchObject({
      changed: true, stateChanged: true, actionChanged: true, destructiveChanged: true,
      approvalChanged: true, adminChanged: true, fileMutationChanged: true,
      networkMutationChanged: true
    });
    const envelope = buildSafetyAuditEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createSafetyAuditLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifySafetyAudit(null)).toThrow('facts must be an object');
    expect(() => classifySafetyAudit({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifySafetyAudit({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifySafetyAudit({ ...facts(), audit: null }))
      .toThrow('requires an audit object');
    expect(() => buildSafetyAuditEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildSafetyAuditEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildSafetyAuditEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildSafetyAuditEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createSafetyAuditLibrary(null)).toThrow('options must be an object');
    expect(() => createSafetyAuditLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
