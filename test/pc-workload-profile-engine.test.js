import {
  WORKLOAD_PROFILE_ENGINE_ID,
  WORKLOAD_PROFILE_ENGINE_VERSION,
  WORKLOAD_PROFILE_TRIGGERS,
  runWorkloadProfileEngine
} from '../pc/engines/workload-profile/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    workload: { kind: 'gaming', name: 'Game', declared: true, interactive: true },
    ...overrides
  };
}

describe('Workload-profile engine', () => {
  test('publishes identity and triggers', () => {
    expect(WORKLOAD_PROFILE_ENGINE_ID).toBe('workload-profile');
    expect(WORKLOAD_PROFILE_ENGINE_VERSION).toBe(1);
    expect(WORKLOAD_PROFILE_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(WORKLOAD_PROFILE_TRIGGERS)).toBe(true);
  });

  test('reports a declared interactive workload without changes', () => {
    const result = runWorkloadProfileEngine(facts(), {
      trigger: 'workload.changed',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: WORKLOAD_PROFILE_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      environment: 'interactive',
      workloadKind: 'gaming',
      workloadName: 'Game',
      declared: true,
      interactive: true,
      state: 'interactive-profile',
      confidence: 1,
      recommendations: ['preserve-user-owned-workload'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('preserves service workload context', () => {
    expect(runWorkloadProfileEngine(facts({
      environment: 'headless',
      workload: { kind: 'server', name: 'service', declared: true, interactive: false }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      workloadKind: 'server',
      state: 'service-profile',
      recommendations: ['preserve-service-workload']
    });
    expect(runWorkloadProfileEngine(facts({
      workload: { kind: 'development', name: 'dev', declared: true, interactive: true }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      workloadKind: 'development',
      state: 'interactive-profile'
    });
  });

  test('reports missing and unknown workload evidence', () => {
    expect(runWorkloadProfileEngine(facts({
      workload: { kind: 'gaming', name: 'unknown', declared: false }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      declared: false,
      state: 'workload-required',
      recommendations: ['request-workload-profile']
    });
    expect(runWorkloadProfileEngine(facts({
      workload: { kind: 'vendor-kind', name: undefined, declared: undefined, interactive: undefined }
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      workloadKind: 'unknown',
      workloadName: null,
      declared: null,
      interactive: null,
      state: 'observation-required',
      confidence: 0.25,
      recommendations: ['request-documented-workload-kind']
    });
  });

  test('handles unknown environment and malformed workload values', () => {
    expect(runWorkloadProfileEngine(facts({
      environment: 'other',
      workload: { kind: '', name: '', declared: 'yes', interactive: 1 }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      workloadKind: 'unknown',
      workloadName: null,
      declared: null,
      interactive: null,
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
  });

  test('requires facts, workload object, triggers, and clock', () => {
    expect(() => runWorkloadProfileEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runWorkloadProfileEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runWorkloadProfileEngine(facts({ workload: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a workload object');
    expect(() => runWorkloadProfileEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported workload-profile trigger: bad');
    expect(() => runWorkloadProfileEngine(facts(), {}))
      .toThrow('Unsupported workload-profile trigger: unknown');
    expect(() => runWorkloadProfileEngine())
      .toThrow('Unsupported workload-profile trigger: unknown');
    expect(() => runWorkloadProfileEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Workload-profile clock must return a number');
  });
});
