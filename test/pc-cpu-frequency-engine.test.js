import {
  CPU_FREQUENCY_ENGINE_ID,
  CPU_FREQUENCY_ENGINE_VERSION,
  CPU_FREQUENCY_TRIGGERS,
  runCpuFrequencyEngine
} from '../pc/engines/cpu-frequency/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    cpu: {
      utilizationPercent: 30,
      governor: 'schedutil',
      driver: 'intel_pstate'
    },
    ...overrides
  };
}

describe('CPU-frequency engine', () => {
  test('publishes identity and triggers', () => {
    expect(CPU_FREQUENCY_ENGINE_ID).toBe('cpu-frequency');
    expect(CPU_FREQUENCY_ENGINE_VERSION).toBe(1);
    expect(CPU_FREQUENCY_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(CPU_FREQUENCY_TRIGGERS)).toBe(true);
  });

  test('preserves adaptive policy on documented interactive hardware', () => {
    const result = runCpuFrequencyEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: CPU_FREQUENCY_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      governor: 'schedutil',
      governorClass: 'adaptive',
      driver: 'intel_pstate',
      driverClass: 'documented',
      state: 'preserve-adaptive-policy',
      confidence: 1,
      recommendations: ['preserve-adaptive-policy'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('classifies fixed governors without applying a policy', () => {
    expect(runCpuFrequencyEngine(facts({ cpu: {
      utilizationPercent: 30, governor: 'performance', driver: 'amd_pstate'
    } }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      governorClass: 'fixed-high',
      driverClass: 'documented',
      state: 'observe',
      recommendations: ['no-change']
    });
    expect(runCpuFrequencyEngine(facts({ cpu: {
      utilizationPercent: 30, governor: 'powersave', driver: 'acpi-cpufreq'
    } }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      governorClass: 'fixed-low',
      driverClass: 'documented'
    });
  });

  test('holds unapproved throughput policy changes on saturated headless hosts', () => {
    expect(runCpuFrequencyEngine(facts({
      environment: 'headless',
      cpu: { utilizationPercent: 95, governor: 'performance', driver: 'amd_pstate' }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      state: 'review-throughput-policy',
      recommendations: [
        'review-documented-frequency-control',
        'hold-unapproved-policy-change'
      ]
    });
  });

  test('keeps missing or vendor-specific evidence conservative', () => {
    expect(runCpuFrequencyEngine(facts({
      cpu: { utilizationPercent: 30, governor: 'vendor', driver: 'vendor' }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      governor: 'vendor',
      governorClass: 'vendor-specific',
      driver: 'vendor',
      driverClass: 'vendor-specific',
      state: 'driver-observation-required',
      confidence: 0.5,
      recommendations: ['request-cpu-driver-observation']
    });
    expect(runCpuFrequencyEngine(facts({
      cpu: { utilizationPercent: 30, governor: 'schedutil' }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      state: 'driver-observation-required'
    });
    expect(runCpuFrequencyEngine(facts({
      cpu: { utilizationPercent: 30, driver: 'intel_pstate' }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      state: 'governor-observation-required'
    });
    expect(runCpuFrequencyEngine(facts({
      cpu: { governor: 'schedutil', driver: 'intel_pstate' }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      state: 'workload-observation-required'
    });
  });

  test('requires an environment profile and rejects malformed inputs', () => {
    expect(runCpuFrequencyEngine(facts({
      environment: 'other',
      cpu: { utilizationPercent: 95, governor: 'performance', driver: 'intel_pstate' }
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      recommendations: ['request-environment-profile']
    });
    expect(() => runCpuFrequencyEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runCpuFrequencyEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runCpuFrequencyEngine(facts({ cpu: null }), { trigger: 'system.facts.request' }))
      .toThrow('require a CPU section');
    expect(() => runCpuFrequencyEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported CPU-frequency trigger: bad');
    expect(() => runCpuFrequencyEngine(facts(), {}))
      .toThrow('Unsupported CPU-frequency trigger: unknown');
    expect(() => runCpuFrequencyEngine())
      .toThrow('Unsupported CPU-frequency trigger: unknown');
    expect(() => runCpuFrequencyEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('CPU-frequency clock must return a number');
  });
});
