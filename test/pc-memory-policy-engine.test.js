import {
  MEMORY_POLICY_ENGINE_ID,
  MEMORY_POLICY_ENGINE_VERSION,
  MEMORY_POLICY_TRIGGERS,
  runMemoryPolicyEngine
} from '../pc/engines/memory-policy/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    memory: {
      usedPercent: 30,
      swapUsedPercent: 0
    },
    ...overrides
  };
}

describe('memory-policy engine', () => {
  test('publishes identity and triggers', () => {
    expect(MEMORY_POLICY_ENGINE_ID).toBe('memory-policy');
    expect(MEMORY_POLICY_ENGINE_VERSION).toBe(1);
    expect(MEMORY_POLICY_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(MEMORY_POLICY_TRIGGERS)).toBe(true);
  });

  test('keeps balanced policy for normal evidence', () => {
    const result = runMemoryPolicyEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: MEMORY_POLICY_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      pressure: 'normal',
      policy: 'balanced',
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('reviews background-low policy for elevated evidence', () => {
    expect(runMemoryPolicyEngine(facts({
      memory: { usedPercent: 80, swapUsedPercent: 40 }
    }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      pressure: 'elevated',
      policy: 'background-low',
      state: 'review-policy',
      recommendations: ['review-background-low-policy', 'require-explicit-consent']
    });
  });

  test('holds current policy for high RAM or swap pressure', () => {
    expect(runMemoryPolicyEngine(facts({
      memory: { usedPercent: 95, swapUsedPercent: 10 }
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      pressure: 'high',
      policy: 'hold-current',
      state: 'hold-policy',
      recommendations: ['hold-current-memory-policy', 'hold-destructive-actions']
    });
    expect(runMemoryPolicyEngine(facts({
      memory: { usedPercent: 40, swapUsedPercent: 80 }
    }), { trigger: 'health.interval', now: () => 0 }).pressure).toBe('high');
  });

  test('reports unknown evidence and environment conservatively', () => {
    const unknownEnvironment = runMemoryPolicyEngine(facts({
      environment: 'other',
      memory: { usedPercent: 95, swapUsedPercent: 80 }
    }), { trigger: 'install.preflight', now: () => 0 });
    expect(unknownEnvironment).toMatchObject({
      environment: 'unknown',
      pressure: 'high',
      policy: 'hold-current',
      state: 'profile-required',
      confidence: 0.75,
      recommendations: ['request-environment-profile']
    });
    expect(runMemoryPolicyEngine(facts({ memory: {} }), {
      trigger: 'system.facts.request',
      now: () => 0
    })).toMatchObject({
      pressure: 'unknown',
      state: 'observation-required',
      confidence: 0.25,
      recommendations: ['request-memory-observation']
    });
  });

  test('clamps percentages and rejects malformed inputs', () => {
    expect(runMemoryPolicyEngine(facts({ memory: {
      usedPercent: 120,
      swapUsedPercent: -4
    } }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      usedPercent: 100,
      swapUsedPercent: 0,
      pressure: 'high'
    });
    expect(() => runMemoryPolicyEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runMemoryPolicyEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runMemoryPolicyEngine(facts({ memory: null }), { trigger: 'system.facts.request' }))
      .toThrow('require a memory section');
    expect(() => runMemoryPolicyEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported memory-policy trigger: bad');
    expect(() => runMemoryPolicyEngine(facts(), {}))
      .toThrow('Unsupported memory-policy trigger: unknown');
    expect(() => runMemoryPolicyEngine())
      .toThrow('Unsupported memory-policy trigger: unknown');
    expect(() => runMemoryPolicyEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Memory-policy clock must return a number');
  });
});
