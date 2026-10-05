import {
  MEMORY_POLICY_PRESSURE_DRIFT_TRIGGERS,
  MEMORY_POLICY_PRESSURE_DRIFT_TURBO_ID,
  MEMORY_POLICY_PRESSURE_DRIFT_TURBO_VERSION,
  runMemoryPolicyPressurePolicyDriftTurbo
} from '../pc/engines/memory-policy/turbos/pressure-policy-drift/turbo.js';

function snapshot(environment, usedPercent, swapUsedPercent = 10, overrides = {}) {
  return {
    engine: 'system-facts',
    environment,
    memory: { usedPercent, swapUsedPercent },
    ...overrides
  };
}

describe('Memory-policy pressure-policy-drift turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(MEMORY_POLICY_PRESSURE_DRIFT_TURBO_ID).toBe('memory-policy.pressure-policy-drift');
    expect(MEMORY_POLICY_PRESSURE_DRIFT_TURBO_VERSION).toBe(1);
    expect(MEMORY_POLICY_PRESSURE_DRIFT_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(MEMORY_POLICY_PRESSURE_DRIFT_TRIGGERS)).toBe(true);
  });

  test('classifies stable, churn, escalation, and recovery transitions', () => {
    const stable = runMemoryPolicyPressurePolicyDriftTurbo([
      snapshot('interactive', 30), snapshot('interactive', 40), snapshot('interactive', 40)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(stable).toMatchObject({ sampleCount: 3, observedCount: 3,
      unknownCount: 0, invalidCount: 0, policyChanges: 0, escalationCount: 0,
      recoveryCount: 0, comparisonCount: 2, state: 'stable-policy', confidence: 1,
      recommendations: ['no-change'], actions: [] });

    const churn = runMemoryPolicyPressurePolicyDriftTurbo([
      snapshot('interactive', 30), snapshot('interactive', 80), snapshot('interactive', 95)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(churn).toMatchObject({ policyChanges: 2, escalationCount: 2,
      state: 'policy-churn', recommendations: ['hold-policy-automation', 'review-policy-transitions'] });

    const escalation = runMemoryPolicyPressurePolicyDriftTurbo([
      snapshot('interactive', 30), snapshot('interactive', 80)
    ], { trigger: 'workload.changed', churnThreshold: 3, escalationThreshold: 1, now: () => 0 });
    expect(escalation).toMatchObject({ policyChanges: 1, escalationCount: 1,
      state: 'policy-escalation', recommendations: ['review-memory-pressure-escalation'] });

    const recovery = runMemoryPolicyPressurePolicyDriftTurbo([
      snapshot('interactive', 95), snapshot('interactive', 30)
    ], { trigger: 'health.interval', churnThreshold: 3, recoveryThreshold: 1, now: () => 0 });
    expect(recovery).toMatchObject({ policyChanges: 1, recoveryCount: 1,
      state: 'policy-recovery', recommendations: ['observe-memory-policy-recovery'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows, handles unknown evidence, and preserves sensor refusal', () => {
    const empty = runMemoryPolicyPressurePolicyDriftTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      invalidCount: 0, comparisonCount: 0, state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-policy-samples'] });

    const insufficient = runMemoryPolicyPressurePolicyDriftTurbo([snapshot('interactive', 30)], {
      trigger: 'health.interval', now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const bounded = runMemoryPolicyPressurePolicyDriftTurbo([
      snapshot('interactive', 30), snapshot('interactive', 80), snapshot('interactive', 95)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2,
      churnThreshold: 3, escalationThreshold: 1, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, observedCount: 2, policyChanges: 1,
      state: 'policy-escalation' });

    const unknown = runMemoryPolicyPressurePolicyDriftTurbo([
      snapshot('interactive', null, null), snapshot('other', null, null)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, invalidCount: 0,
      state: 'no-observation', confidence: 0,
      recommendations: ['request-memory-policy-observation'] });

    const invalid = runMemoryPolicyPressurePolicyDriftTurbo([
      snapshot('interactive', 120, 10), snapshot('interactive', 50, 10)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(invalid).toMatchObject({ observedCount: 1, invalidCount: 1,
      state: 'invalid-policy-evidence', recommendations: ['review-memory-policy-sensor-range'] });
  });

  test('skips unknown transitions while retaining valid posture changes', () => {
    const result = runMemoryPolicyPressurePolicyDriftTurbo([
      snapshot('interactive', 30), snapshot('interactive', null, null), snapshot('interactive', 80)
    ], { trigger: 'health.interval', churnThreshold: 3, escalationThreshold: 1, now: () => 0 });
    expect(result).toMatchObject({ observedCount: 2, unknownCount: 1,
      comparisonCount: 0, policyChanges: 0, escalationCount: 0,
      state: 'stable-policy' });
  });

  test('rejects malformed inputs, bounds, snapshots, and clocks', () => {
    expect(() => runMemoryPolicyPressurePolicyDriftTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runMemoryPolicyPressurePolicyDriftTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported memory-policy pressure-policy-drift trigger: bad');
    expect(() => runMemoryPolicyPressurePolicyDriftTurbo()).toThrow(
      'Unsupported memory-policy pressure-policy-drift trigger: unknown'
    );
    expect(() => runMemoryPolicyPressurePolicyDriftTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPolicyPressurePolicyDriftTurbo([], {
      trigger: 'health.interval', windowSize: 65
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPolicyPressurePolicyDriftTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runMemoryPolicyPressurePolicyDriftTurbo([], {
      trigger: 'health.interval', minimumSamples: 0
    })).toThrow('minimumSamples must fit inside the window');
    for (const option of ['churnThreshold', 'escalationThreshold', 'recoveryThreshold']) {
      expect(() => runMemoryPolicyPressurePolicyDriftTurbo([], {
        trigger: 'health.interval', [option]: 0
      })).toThrow(`${option} must be an integer from 1 to 64`);
      expect(() => runMemoryPolicyPressurePolicyDriftTurbo([], {
        trigger: 'health.interval', [option]: 65
      })).toThrow(`${option} must be an integer from 1 to 64`);
    }
    expect(() => runMemoryPolicyPressurePolicyDriftTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runMemoryPolicyPressurePolicyDriftTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runMemoryPolicyPressurePolicyDriftTurbo([
      { engine: 'other' }, snapshot('interactive', 30)
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runMemoryPolicyPressurePolicyDriftTurbo([
      snapshot('interactive', 30, 10, { memory: null }), snapshot('interactive', 30)
    ], { trigger: 'health.interval' })).toThrow('requires a memory section');
  });
});
