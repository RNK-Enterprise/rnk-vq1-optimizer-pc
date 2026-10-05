import {
  MEMORY_POLICY_CONSENT_BOUNDARY_TRIGGERS,
  MEMORY_POLICY_CONSENT_BOUNDARY_TURBO_ID,
  MEMORY_POLICY_CONSENT_BOUNDARY_TURBO_VERSION,
  runMemoryPolicyConsentBoundaryTurbo
} from '../pc/engines/memory-policy/turbos/consent-boundary/turbo.js';

function snapshot(currentPolicy, requestedPolicy, consentGranted = true,
  destructiveActionRequested = false, overrides = {}) {
  return {
    engine: 'system-facts',
    memory: {
      currentPolicy,
      requestedPolicy,
      consentGranted,
      destructiveActionRequested
    },
    ...overrides
  };
}

describe('Memory-policy consent-boundary turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(MEMORY_POLICY_CONSENT_BOUNDARY_TURBO_ID).toBe('memory-policy.consent-boundary');
    expect(MEMORY_POLICY_CONSENT_BOUNDARY_TURBO_VERSION).toBe(1);
    expect(MEMORY_POLICY_CONSENT_BOUNDARY_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(MEMORY_POLICY_CONSENT_BOUNDARY_TRIGGERS)).toBe(true);
  });

  test('classifies aligned, consent-required, destructive-blocked, and no-request states', () => {
    const aligned = runMemoryPolicyConsentBoundaryTurbo([
      snapshot('balanced', 'balanced', true, false),
      snapshot('background-low', 'background-low', true, false)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(aligned).toMatchObject({ sampleCount: 2, observedCount: 2,
      unknownCount: 0, invalidCount: 0, blockedCount: 0, consentGapCount: 0,
      requestCount: 2, state: 'consent-aligned', confidence: 1,
      recommendations: ['no-change'], actions: [] });

    const required = runMemoryPolicyConsentBoundaryTurbo([
      snapshot('balanced', 'background-low', false, false),
      snapshot('balanced', 'background-low', false, false)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(required).toMatchObject({ consentGapCount: 2, blockedCount: 0,
      state: 'consent-required', recommendations: ['require-explicit-consent', 'hold-policy-automation'] });

    const blocked = runMemoryPolicyConsentBoundaryTurbo([
      snapshot('balanced', 'background-low', false, true),
      snapshot('balanced', 'background-low', false, true)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(blocked).toMatchObject({ blockedCount: 2, state: 'destructive-blocked',
      recommendations: ['hold-destructive-actions', 'require-explicit-consent'] });

    const noRequest = runMemoryPolicyConsentBoundaryTurbo([
      snapshot('balanced', undefined, undefined, undefined),
      snapshot('balanced', undefined, undefined, undefined)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(noRequest).toMatchObject({ observedCount: 2, requestCount: 0,
      state: 'no-policy-request', recommendations: ['no-policy-change-request'] });
    expect(Object.isFrozen(aligned)).toBe(true);
    expect(Object.isFrozen(aligned.actions)).toBe(true);
  });

  test('bounds windows, handles unknown evidence, and preserves invalid input', () => {
    const empty = runMemoryPolicyConsentBoundaryTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      invalidCount: 0, state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-consent-samples'] });

    const insufficient = runMemoryPolicyConsentBoundaryTurbo([snapshot('balanced', 'balanced')], {
      trigger: 'health.interval', now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const bounded = runMemoryPolicyConsentBoundaryTurbo([
      snapshot('balanced', 'balanced'), snapshot('balanced', 'background-low', false),
      snapshot('balanced', 'background-low', false)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, consentGapCount: 2, state: 'consent-required' });

    const unknown = runMemoryPolicyConsentBoundaryTurbo([
      { engine: 'system-facts', memory: {} },
      { engine: 'system-facts', memory: {} }
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, invalidCount: 0,
      state: 'no-observation', confidence: 0,
      recommendations: ['request-policy-consent-observation'] });

    const invalid = runMemoryPolicyConsentBoundaryTurbo([
      snapshot('balanced', 'unknown-policy', true, false),
      snapshot('balanced', 'balanced', true, false)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(invalid).toMatchObject({ observedCount: 1, invalidCount: 1,
      state: 'invalid-consent-evidence', recommendations: ['review-policy-consent-input'] });
  });

  test('covers optional boolean refusal and consent boundary combinations', () => {
    const result = runMemoryPolicyConsentBoundaryTurbo([
      snapshot('balanced', 'background-low', null, null),
      snapshot('balanced', 'balanced', false, false)
    ], { trigger: 'health.interval', gapThreshold: 2, now: () => 0 });
    expect(result).toMatchObject({ observedCount: 1, consentGapCount: 1,
      blockedCount: 0, requestCount: 2, state: 'invalid-consent-evidence' });

    const invalid = runMemoryPolicyConsentBoundaryTurbo([
      snapshot('balanced', null, true, false),
      snapshot('balanced', 'balanced', true, 'yes')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(invalid).toMatchObject({ invalidCount: 2, state: 'invalid-consent-evidence' });
  });

  test('rejects malformed inputs, bounds, snapshots, and clocks', () => {
    expect(() => runMemoryPolicyConsentBoundaryTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runMemoryPolicyConsentBoundaryTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported memory-policy consent-boundary trigger: bad');
    expect(() => runMemoryPolicyConsentBoundaryTurbo()).toThrow(
      'Unsupported memory-policy consent-boundary trigger: unknown'
    );
    expect(() => runMemoryPolicyConsentBoundaryTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPolicyConsentBoundaryTurbo([], {
      trigger: 'health.interval', windowSize: 65
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPolicyConsentBoundaryTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runMemoryPolicyConsentBoundaryTurbo([], {
      trigger: 'health.interval', minimumSamples: 0
    })).toThrow('minimumSamples must fit inside the window');
    for (const option of ['blockedThreshold', 'gapThreshold']) {
      expect(() => runMemoryPolicyConsentBoundaryTurbo([], {
        trigger: 'health.interval', [option]: 0
      })).toThrow(`${option} must be an integer from 1 to 64`);
      expect(() => runMemoryPolicyConsentBoundaryTurbo([], {
        trigger: 'health.interval', [option]: 65
      })).toThrow(`${option} must be an integer from 1 to 64`);
    }
    expect(() => runMemoryPolicyConsentBoundaryTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runMemoryPolicyConsentBoundaryTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runMemoryPolicyConsentBoundaryTurbo([
      { engine: 'other' }, snapshot('balanced', 'balanced')
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runMemoryPolicyConsentBoundaryTurbo([
      snapshot('balanced', 'balanced', true, false, { memory: null }), snapshot('balanced', 'balanced')
    ], { trigger: 'health.interval' })).toThrow('requires a memory section');
  });
});
