import {
  SAFETY_AUDIT_ENGINE_ID,
  SAFETY_AUDIT_ENGINE_VERSION,
  SAFETY_AUDIT_TRIGGERS,
  runSafetyAuditEngine
} from '../pc/engines/safety-audit/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    audit: {
      actionCount: 0,
      destructiveCount: 0,
      userApproval: true,
      adminRequired: false,
      fileMutation: false,
      networkMutation: false
    },
    ...overrides
  };
}

describe('Safety-audit engine', () => {
  test('publishes identity and triggers', () => {
    expect(SAFETY_AUDIT_ENGINE_ID).toBe('safety-audit');
    expect(SAFETY_AUDIT_ENGINE_VERSION).toBe(1);
    expect(SAFETY_AUDIT_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(SAFETY_AUDIT_TRIGGERS)).toBe(true);
  });

  test('reports no proposed actions without executing anything', () => {
    const result = runSafetyAuditEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: SAFETY_AUDIT_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      actionCount: 0,
      destructiveCount: 0,
      userApproval: true,
      adminRequired: false,
      fileMutation: false,
      networkMutation: false,
      state: 'no-actions',
      confidence: 1,
      recommendations: ['no-action-review'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('rejects destructive proposals before approval or admin review', () => {
    expect(runSafetyAuditEngine(facts({ audit: {
      actionCount: 2,
      destructiveCount: 1,
      userApproval: true,
      adminRequired: true,
      fileMutation: true,
      networkMutation: true
    } }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      state: 'unsafe-proposal',
      recommendations: ['reject-destructive-proposal']
    });
  });

  test('requires approval and separates admin review', () => {
    expect(runSafetyAuditEngine(facts({ audit: {
      actionCount: 1,
      destructiveCount: 0,
      userApproval: false,
      adminRequired: false,
      fileMutation: true,
      networkMutation: false
    } }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      state: 'approval-required',
      recommendations: ['request-explicit-user-approval']
    });
    expect(runSafetyAuditEngine(facts({ audit: {
      actionCount: 1,
      destructiveCount: 0,
      userApproval: true,
      adminRequired: true,
      fileMutation: false,
      networkMutation: false
    } }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      state: 'admin-review',
      recommendations: ['show-admin-required-boundary']
    });
    expect(runSafetyAuditEngine(facts({ audit: {
      actionCount: 1,
      destructiveCount: 0,
      userApproval: true,
      adminRequired: false,
      fileMutation: false,
      networkMutation: true
    } }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      state: 'reviewed',
      recommendations: ['permit-review-only']
    });
  });

  test('reports incomplete audit evidence and bounds counters', () => {
    expect(runSafetyAuditEngine(facts({ audit: {} }), {
      trigger: 'install.preflight',
      now: () => 0
    })).toMatchObject({
      actionCount: null,
      destructiveCount: null,
      userApproval: null,
      adminRequired: null,
      fileMutation: null,
      networkMutation: null,
      state: 'approval-required',
      confidence: 0.2
    });
    expect(runSafetyAuditEngine(facts({ audit: {
      actionCount: -1,
      destructiveCount: -2,
      userApproval: 'yes',
      adminRequired: 1,
      fileMutation: 1,
      networkMutation: 1
    } }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      actionCount: null,
      destructiveCount: null,
      userApproval: null,
      adminRequired: null,
      fileMutation: null,
      networkMutation: null
    });
  });

  test('handles unknown environment and rejects malformed inputs', () => {
    expect(runSafetyAuditEngine(facts({
      environment: 'other',
      audit: {}
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(() => runSafetyAuditEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runSafetyAuditEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runSafetyAuditEngine(facts({ audit: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require an audit object');
    expect(() => runSafetyAuditEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported safety-audit trigger: bad');
    expect(() => runSafetyAuditEngine(facts(), {}))
      .toThrow('Unsupported safety-audit trigger: unknown');
    expect(() => runSafetyAuditEngine())
      .toThrow('Unsupported safety-audit trigger: unknown');
    expect(() => runSafetyAuditEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Safety-audit clock must return a number');
  });
});
