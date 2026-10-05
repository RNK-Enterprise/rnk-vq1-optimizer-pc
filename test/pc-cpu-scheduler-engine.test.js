import {
  CPU_SCHEDULER_ENGINE_ID,
  CPU_SCHEDULER_ENGINE_VERSION,
  CPU_SCHEDULER_TRIGGERS,
  runCpuSchedulerEngine
} from '../pc/engines/cpu-scheduler/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    cpu: {
      utilizationPercent: 20,
      governor: 'schedutil',
      driver: 'intel_pstate'
    },
    ...overrides
  };
}

describe('CPU-scheduler engine', () => {
  test('publishes identity and triggers', () => {
    expect(CPU_SCHEDULER_ENGINE_ID).toBe('cpu-scheduler');
    expect(CPU_SCHEDULER_ENGINE_VERSION).toBe(1);
    expect(CPU_SCHEDULER_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(CPU_SCHEDULER_TRIGGERS)).toBe(true);
  });

  test('reports a balanced interactive scheduler with schedutil alignment', () => {
    const result = runCpuSchedulerEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: CPU_SCHEDULER_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      environment: 'interactive',
      workload: 'normal',
      profile: 'balanced',
      governor: 'schedutil',
      driver: 'intel_pstate',
      alignment: 'aligned',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(runCpuSchedulerEngine(facts({
      cpu: { utilizationPercent: 20, governor: 'performance' }
    }), { trigger: 'system.facts.request', now: () => 0 }).alignment).toBe('acceptable');
  });

  test('classifies busy interactive work and accepts performance or schedutil', () => {
    expect(runCpuSchedulerEngine(facts({
      cpu: { utilizationPercent: 70, governor: 'performance' }
    }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      workload: 'busy',
      profile: 'latency-sensitive',
      alignment: 'aligned',
      recommendations: ['no-change']
    });
    expect(runCpuSchedulerEngine(facts({
      cpu: { utilizationPercent: 90, governor: 'schedutil' }
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      workload: 'saturated',
      profile: 'latency-sensitive',
      alignment: 'aligned'
    });
  });

  test('classifies busy headless work as throughput and reviews powersave', () => {
    const result = runCpuSchedulerEngine(facts({
      environment: 'headless',
      cpu: { utilizationPercent: 70, governor: 'powersave', driver: 'acpi-cpufreq' }
    }), { trigger: 'install.preflight', now: () => 0 });
    expect(result).toMatchObject({
      environment: 'headless',
      workload: 'busy',
      profile: 'throughput',
      governor: 'powersave',
      alignment: 'review',
      confidence: 1,
      recommendations: ['review-documented-governor-control']
    });
  });

  test('keeps unknown environments and governors conservative', () => {
    const unknownEnvironment = runCpuSchedulerEngine(facts({
      environment: 'other',
      cpu: { utilizationPercent: 90, governor: 'performance' }
    }), { trigger: 'system.facts.request', now: () => 0 });
    expect(unknownEnvironment).toMatchObject({
      environment: 'unknown',
      profile: 'profile-required',
      alignment: 'profile-required',
      recommendations: ['request-environment-profile']
    });

    const unknownGovernor = runCpuSchedulerEngine(facts({
      cpu: { utilizationPercent: 20, governor: 'vendor-governor' }
    }), { trigger: 'system.facts.request', now: () => 0 });
    expect(unknownGovernor).toMatchObject({
      governor: null,
      alignment: 'unknown',
      recommendations: ['request-cpu-scheduler-observation']
    });
  });

  test('reports missing utilization and rejects malformed inputs', () => {
    expect(runCpuSchedulerEngine(facts({ cpu: {} }), {
      trigger: 'system.facts.request',
      now: () => 0
    })).toMatchObject({
      workload: 'unknown',
      profile: 'observation-required',
      alignment: 'unknown',
      confidence: 0.35,
      recommendations: ['request-cpu-scheduler-observation']
    });
    expect(() => runCpuSchedulerEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runCpuSchedulerEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runCpuSchedulerEngine(facts({ cpu: null }), { trigger: 'system.facts.request' }))
      .toThrow('require a CPU section');
    expect(() => runCpuSchedulerEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported CPU-scheduler trigger: bad');
    expect(() => runCpuSchedulerEngine(facts(), {}))
      .toThrow('Unsupported CPU-scheduler trigger: unknown');
    expect(() => runCpuSchedulerEngine())
      .toThrow('Unsupported CPU-scheduler trigger: unknown');
    expect(() => runCpuSchedulerEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('CPU-scheduler clock must return a number');
  });
});
