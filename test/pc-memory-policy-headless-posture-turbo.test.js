import {
  MEMORY_POLICY_HEADLESS_POSTURE_TRIGGERS,
  MEMORY_POLICY_HEADLESS_POSTURE_TURBO_ID,
  MEMORY_POLICY_HEADLESS_POSTURE_TURBO_VERSION,
  runMemoryPolicyHeadlessPostureTurbo
} from '../pc/engines/memory-policy/turbos/headless-posture/turbo.js';

function snapshot(environment, usedPercent, swapUsedPercent, currentPolicy, overrides = {}) {
  return {
    engine: 'system-facts',
    environment,
    memory: { usedPercent, swapUsedPercent, currentPolicy },
    ...overrides
  };
}

describe('Memory-policy headless-posture turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(MEMORY_POLICY_HEADLESS_POSTURE_TURBO_ID).toBe('memory-policy.headless-posture');
    expect(MEMORY_POLICY_HEADLESS_POSTURE_TURBO_VERSION).toBe(1);
    expect(MEMORY_POLICY_HEADLESS_POSTURE_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(MEMORY_POLICY_HEADLESS_POSTURE_TRIGGERS)).toBe(true);
  });

  test('classifies aligned, headless-gap, interactive-gap, and profile states', () => {
    const aligned = runMemoryPolicyHeadlessPostureTurbo([
      snapshot('interactive', 30, 10, 'balanced'),
      snapshot('headless', 80, 10, 'background-low'),
      snapshot('headless', 95, 10, 'hold-current')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(aligned).toMatchObject({ sampleCount: 3, observedCount: 3,
      unknownCount: 0, invalidCount: 0, headlessGapCount: 0, interactiveGapCount: 0,
      unknownEnvironmentCount: 0, state: 'aligned-posture', confidence: 1,
      recommendations: ['no-change'], actions: [] });

    const headlessGap = runMemoryPolicyHeadlessPostureTurbo([
      snapshot('headless', 95, 10, 'balanced'), snapshot('headless', 95, 10, 'balanced')
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(headlessGap).toMatchObject({ headlessGapCount: 2,
      state: 'headless-protection-gap', recommendations: ['hold-headless-policy-automation', 'review-service-protection'] });

    const interactiveGap = runMemoryPolicyHeadlessPostureTurbo([
      snapshot('interactive', 80, 10, 'balanced'), snapshot('interactive', 80, 10, 'balanced')
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(interactiveGap).toMatchObject({ interactiveGapCount: 2,
      state: 'interactive-policy-gap', recommendations: ['review-interactive-memory-policy'] });

    const profile = runMemoryPolicyHeadlessPostureTurbo([
      snapshot('other', 30, 10, 'hold-current'), snapshot('other', 30, 10, 'hold-current')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(profile).toMatchObject({ observedCount: 2, unknownEnvironmentCount: 2,
      state: 'profile-required', recommendations: ['request-environment-profile'] });
    expect(Object.isFrozen(aligned)).toBe(true);
    expect(Object.isFrozen(aligned.actions)).toBe(true);
  });

  test('bounds windows, handles missing policy, and preserves sensor refusal', () => {
    const empty = runMemoryPolicyHeadlessPostureTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      invalidCount: 0, state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-posture-samples'] });

    const insufficient = runMemoryPolicyHeadlessPostureTurbo([
      snapshot('interactive', 30, 10, 'balanced')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const bounded = runMemoryPolicyHeadlessPostureTurbo([
      snapshot('interactive', 30, 10, 'balanced'),
      snapshot('interactive', 80, 10, 'balanced'),
      snapshot('interactive', 80, 10, 'balanced')
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, interactiveGapCount: 2,
      state: 'interactive-policy-gap' });

    const noObservation = runMemoryPolicyHeadlessPostureTurbo([
      { engine: 'system-facts', environment: 'interactive', memory: { usedPercent: 30 } },
      { engine: 'system-facts', environment: 'interactive', memory: { usedPercent: 30 } }
    ], { trigger: 'health.interval', now: () => 0 });
    expect(noObservation).toMatchObject({ observedCount: 0, unknownCount: 2,
      state: 'no-observation', recommendations: ['request-memory-policy-observation'] });

    const invalid = runMemoryPolicyHeadlessPostureTurbo([
      snapshot('interactive', 120, 10, 'balanced'), snapshot('interactive', 30, 10, 'balanced')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(invalid).toMatchObject({ observedCount: 1, invalidCount: 1,
      state: 'invalid-posture-evidence', recommendations: ['review-memory-policy-sensor-range'] });
  });

  test('handles unknown policy and pressure inputs conservatively', () => {
    const invalid = runMemoryPolicyHeadlessPostureTurbo([
      snapshot('interactive', 30, 10, 'other'), snapshot('interactive', 30, 10, 'balanced')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(invalid).toMatchObject({ observedCount: 1, invalidCount: 1,
      state: 'invalid-posture-evidence' });

    const unknownPressure = runMemoryPolicyHeadlessPostureTurbo([
      snapshot('interactive', null, null, 'hold-current'),
      snapshot('interactive', null, null, 'hold-current')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknownPressure).toMatchObject({ observedCount: 2, state: 'aligned-posture' });
  });

  test('rejects malformed inputs, bounds, snapshots, and clocks', () => {
    expect(() => runMemoryPolicyHeadlessPostureTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runMemoryPolicyHeadlessPostureTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported memory-policy headless-posture trigger: bad');
    expect(() => runMemoryPolicyHeadlessPostureTurbo()).toThrow(
      'Unsupported memory-policy headless-posture trigger: unknown'
    );
    expect(() => runMemoryPolicyHeadlessPostureTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPolicyHeadlessPostureTurbo([], {
      trigger: 'health.interval', windowSize: 65
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPolicyHeadlessPostureTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runMemoryPolicyHeadlessPostureTurbo([], {
      trigger: 'health.interval', minimumSamples: 0
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runMemoryPolicyHeadlessPostureTurbo([], {
      trigger: 'health.interval', gapThreshold: 0
    })).toThrow('gapThreshold must be an integer from 1 to 64');
    expect(() => runMemoryPolicyHeadlessPostureTurbo([], {
      trigger: 'health.interval', gapThreshold: 65
    })).toThrow('gapThreshold must be an integer from 1 to 64');
    expect(() => runMemoryPolicyHeadlessPostureTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runMemoryPolicyHeadlessPostureTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runMemoryPolicyHeadlessPostureTurbo([
      { engine: 'other' }, snapshot('interactive', 30, 10, 'balanced')
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runMemoryPolicyHeadlessPostureTurbo([
      snapshot('interactive', 30, 10, 'balanced', { memory: null }),
      snapshot('interactive', 30, 10, 'balanced')
    ], { trigger: 'health.interval' })).toThrow('requires a memory section');
  });
});
