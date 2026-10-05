import {
  CPU_UTILIZATION_ENGINE_ID,
  CPU_UTILIZATION_ENGINE_VERSION,
  CPU_UTILIZATION_TRIGGERS,
  runCpuUtilizationEngine
} from '../pc/engines/cpu-utilization/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    cpu: {
      model: 'test-cpu',
      logicalCpus: 8,
      utilizationPercent: 20
    },
    ...overrides
  };
}

describe('CPU-utilization engine', () => {
  test('publishes identity and triggers', () => {
    expect(CPU_UTILIZATION_ENGINE_ID).toBe('cpu-utilization');
    expect(CPU_UTILIZATION_ENGINE_VERSION).toBe(1);
    expect(CPU_UTILIZATION_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(CPU_UTILIZATION_TRIGGERS)).toBe(true);
  });

  test('reports idle utilization without recommending changes', () => {
    const result = runCpuUtilizationEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: CPU_UTILIZATION_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      utilizationPercent: 20,
      headroomPercent: 80,
      logicalCpus: 8,
      model: 'test-cpu',
      level: 'idle',
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('classifies balanced and busy CPU levels', () => {
    expect(runCpuUtilizationEngine(facts({ cpu: { utilizationPercent: 50 } }), {
      trigger: 'workload.changed',
      now: () => 0
    })).toMatchObject({ level: 'balanced', state: 'observe' });
    expect(runCpuUtilizationEngine(facts({ cpu: { utilizationPercent: 70 } }), {
      trigger: 'health.interval',
      now: () => 0
    })).toMatchObject({
      level: 'busy',
      state: 'contention-watch',
      confidence: 0.6,
      recommendations: ['observe-next-sample', 'avoid-unapproved-affinity-changes']
    });
  });

  test('protects headless services at saturation', () => {
    const result = runCpuUtilizationEngine(facts({
      environment: 'headless',
      cpu: { utilizationPercent: 120, logicalCpus: 16, model: 'server-cpu' }
    }), { trigger: 'install.preflight', now: () => 0 });
    expect(result).toMatchObject({
      environment: 'headless',
      utilizationPercent: 100,
      headroomPercent: 0,
      level: 'saturated',
      state: 'protect-services',
      recommendations: ['protect-services', 'hold-destructive-actions']
    });
  });

  test('protects the foreground on interactive saturation', () => {
    expect(runCpuUtilizationEngine(facts({
      cpu: { utilizationPercent: 85 }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      level: 'saturated',
      state: 'protect-foreground',
      recommendations: ['protect-foreground', 'hold-destructive-actions']
    });
  });

  test('reports unknown utilization and unknown environments conservatively', () => {
    const result = runCpuUtilizationEngine(facts({
      environment: 'other',
      cpu: {}
    }), { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({
      environment: 'unknown',
      utilizationPercent: null,
      headroomPercent: null,
      logicalCpus: null,
      model: null,
      level: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(runCpuUtilizationEngine(facts({ cpu: {} }), {
      trigger: 'system.facts.request',
      now: () => 0
    }).recommendations).toEqual(['request-cpu-observation']);
  });

  test('rejects malformed facts, triggers, and clocks', () => {
    expect(() => runCpuUtilizationEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runCpuUtilizationEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runCpuUtilizationEngine(facts({ cpu: null }), { trigger: 'system.facts.request' }))
      .toThrow('require a CPU section');
    expect(() => runCpuUtilizationEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported CPU-utilization trigger: bad');
    expect(() => runCpuUtilizationEngine(facts(), {}))
      .toThrow('Unsupported CPU-utilization trigger: unknown');
    expect(() => runCpuUtilizationEngine())
      .toThrow('Unsupported CPU-utilization trigger: unknown');
    expect(() => runCpuUtilizationEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('CPU-utilization clock must return a number');
  });
});
