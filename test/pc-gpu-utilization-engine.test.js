import {
  GPU_UTILIZATION_ENGINE_ID,
  GPU_UTILIZATION_ENGINE_VERSION,
  GPU_UTILIZATION_TRIGGERS,
  runGpuUtilizationEngine
} from '../pc/engines/gpu-utilization/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    gpus: [{
      model: 'Test GPU',
      utilizationPercent: 30,
      temperatureCelsius: 45,
      vramBytes: 4000
    }],
    ...overrides
  };
}

describe('GPU-utilization engine', () => {
  test('publishes identity and triggers', () => {
    expect(GPU_UTILIZATION_ENGINE_ID).toBe('gpu-utilization');
    expect(GPU_UTILIZATION_ENGINE_VERSION).toBe(1);
    expect(GPU_UTILIZATION_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(GPU_UTILIZATION_TRIGGERS)).toBe(true);
  });

  test('reports normal GPU utilization and preserves controls', () => {
    const result = runGpuUtilizationEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: GPU_UTILIZATION_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      gpuCount: 1,
      models: ['Test GPU'],
      utilizationPercent: 30,
      temperatureCelsius: 45,
      maximumVramBytes: 4000,
      level: 'normal',
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('aggregates elevated and high utilization or temperature', () => {
    expect(runGpuUtilizationEngine(facts({ gpus: [
      { model: 'A', utilizationPercent: 70, temperatureCelsius: 50, vramBytes: 100 },
      { model: 'B', utilizationPercent: 20, temperatureCelsius: 80, vramBytes: 200 }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      gpuCount: 2,
      utilizationPercent: 70,
      temperatureCelsius: 80,
      maximumVramBytes: 200,
      level: 'elevated',
      state: 'watch',
      recommendations: ['observe-next-sample', 'review-thermal-headroom']
    });
    expect(runGpuUtilizationEngine(facts({
      environment: 'headless',
      gpus: [{ model: 'Server GPU', utilizationPercent: 95, temperatureCelsius: 60 }]
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      level: 'high',
      state: 'protect-services',
      recommendations: ['protect-services', 'hold-unapproved-gpu-policy']
    });
    expect(runGpuUtilizationEngine(facts({
      gpus: [{ model: 'GPU', utilizationPercent: 20, temperatureCelsius: 90 }]
    }), { trigger: 'health.interval', now: () => 0 }).state).toBe('protect-foreground');
  });

  test('treats no-GPU hosts as explicit observation state', () => {
    const result = runGpuUtilizationEngine(facts({
      environment: 'headless',
      gpus: []
    }), { trigger: 'install.preflight', now: () => 0 });
    expect(result).toMatchObject({
      gpuCount: 0,
      level: 'none',
      state: 'no-gpu',
      confidence: 0.2,
      recommendations: ['no-change', 'keep-gpu-controls-disabled']
    });
  });

  test('reports unknown measurements and environments conservatively', () => {
    const unknownEnvironment = runGpuUtilizationEngine(facts({
      environment: 'other',
      gpus: [{}]
    }), { trigger: 'system.facts.request', now: () => 0 });
    expect(unknownEnvironment).toMatchObject({
      environment: 'unknown',
      gpuCount: 1,
      utilizationPercent: null,
      temperatureCelsius: null,
      level: 'unknown',
      state: 'profile-required',
      confidence: 0.2,
      recommendations: ['request-environment-profile']
    });
    expect(runGpuUtilizationEngine(facts({ gpus: [{}] }), {
      trigger: 'system.facts.request',
      now: () => 0
    }).recommendations).toEqual(['request-gpu-observation']);
  });

  test('clamps observations, filters malformed GPU rows, and rejects inputs', () => {
    expect(runGpuUtilizationEngine(facts({ gpus: [null, {
      model: '', utilizationPercent: 120, temperatureCelsius: -5, vramBytes: -1
    }] }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      gpuCount: 1,
      models: [],
      utilizationPercent: 100,
      temperatureCelsius: 0,
      maximumVramBytes: null,
      level: 'high'
    });
    expect(() => runGpuUtilizationEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runGpuUtilizationEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runGpuUtilizationEngine(facts({ gpus: null }), { trigger: 'system.facts.request' }))
      .toThrow('require a GPU list');
    expect(() => runGpuUtilizationEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported GPU-utilization trigger: bad');
    expect(() => runGpuUtilizationEngine(facts(), {}))
      .toThrow('Unsupported GPU-utilization trigger: unknown');
    expect(() => runGpuUtilizationEngine())
      .toThrow('Unsupported GPU-utilization trigger: unknown');
    expect(() => runGpuUtilizationEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('GPU-utilization clock must return a number');
  });
});
