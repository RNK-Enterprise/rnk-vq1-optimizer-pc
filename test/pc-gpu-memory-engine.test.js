import {
  GPU_MEMORY_ENGINE_ID,
  GPU_MEMORY_ENGINE_VERSION,
  GPU_MEMORY_TRIGGERS,
  runGpuMemoryEngine
} from '../pc/engines/gpu-memory/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { gpuMemoryObservation: true },
    gpus: [{ model: 'Test GPU', vramBytes: 8000, vramUsedBytes: 2000 }],
    ...overrides
  };
}

describe('GPU-memory engine', () => {
  test('publishes identity and triggers', () => {
    expect(GPU_MEMORY_ENGINE_ID).toBe('gpu-memory');
    expect(GPU_MEMORY_ENGINE_VERSION).toBe(1);
    expect(GPU_MEMORY_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(GPU_MEMORY_TRIGGERS)).toBe(true);
  });

  test('reports observed VRAM headroom without changes', () => {
    const result = runGpuMemoryEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: GPU_MEMORY_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      gpuCount: 1,
      models: ['Test GPU'],
      maximumVramBytes: 8000,
      maximumVramUsedBytes: 2000,
      maximumVramUsedPercent: 25,
      evidence: 'observed',
      level: 'normal',
      observationEnabled: true,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('aggregates elevated and high memory pressure conservatively', () => {
    expect(runGpuMemoryEngine(facts({ gpus: [
      { model: 'A', vramBytes: 1000, vramUsedBytes: 750 },
      { model: 'B', vramBytes: 2000, vramUsedBytes: 1900 }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      gpuCount: 2,
      maximumVramBytes: 2000,
      maximumVramUsedBytes: 1900,
      maximumVramUsedPercent: 95,
      level: 'high',
      state: 'protect-foreground',
      recommendations: ['protect-foreground', 'hold-unapproved-memory-policy']
    });
    expect(runGpuMemoryEngine(facts({
      environment: 'headless',
      gpus: [{ model: 'Server GPU', vramBytes: 1000, vramUsedBytes: 900 }]
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      level: 'high',
      state: 'protect-services'
    });
    expect(runGpuMemoryEngine(facts({
      gpus: [{ model: 'GPU', vramBytes: 1000, vramUsedBytes: 800 }]
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      level: 'elevated',
      state: 'watch',
      recommendations: ['observe-next-sample', 'review-vram-headroom']
    });
  });

  test('reports capacity-only and disabled observation states', () => {
    expect(runGpuMemoryEngine(facts({
      capabilities: { gpuMemoryObservation: false },
      gpus: [{ model: 'GPU', vramBytes: 4000 }]
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      evidence: 'capacity-only',
      maximumVramBytes: 4000,
      maximumVramUsedBytes: null,
      maximumVramUsedPercent: null,
      observationEnabled: false,
      state: 'observation-disabled',
      recommendations: ['keep-gpu-memory-observation-disabled']
    });
  });

  test('treats no-GPU, unknown, and missing observations conservatively', () => {
    expect(runGpuMemoryEngine(facts({
      environment: 'headless',
      gpus: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      gpuCount: 0,
      evidence: 'none',
      level: 'unknown',
      state: 'no-gpu',
      confidence: 0.2,
      recommendations: ['keep-gpu-memory-controls-disabled']
    });
    expect(runGpuMemoryEngine(facts({
      environment: 'other',
      gpus: [{ model: 'GPU' }]
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      evidence: 'unknown',
      state: 'profile-required',
      recommendations: ['request-environment-profile']
    });
    expect(runGpuMemoryEngine(facts({ gpus: [{ model: 'GPU', vramBytes: 1000 }] }), {
      trigger: 'system.facts.request',
      now: () => 0
    })).toMatchObject({
      evidence: 'capacity-only',
      state: 'observation-required',
      recommendations: ['request-gpu-memory-observation']
    });
  });

  test('bounds observations, filters malformed rows, and rejects inputs', () => {
    expect(runGpuMemoryEngine(facts({ gpus: [null, {
      model: '', vramBytes: 1000, vramUsedBytes: 1200
    }] }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      gpuCount: 1,
      models: [],
      maximumVramBytes: 1000,
      maximumVramUsedBytes: 1200,
      maximumVramUsedPercent: 100,
      level: 'high'
    });
    expect(runGpuMemoryEngine(facts({ gpus: [{}] }), {
      trigger: 'system.facts.request',
      now: () => 0
    }).confidence).toBe(0.4);
    expect(runGpuMemoryEngine(facts({
      gpus: [{ model: 'GPU', vramBytes: 0, vramUsedBytes: 0 }]
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      evidence: 'capacity-only',
      maximumVramUsedPercent: null,
      state: 'observation-required'
    });
    expect(() => runGpuMemoryEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runGpuMemoryEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runGpuMemoryEngine(facts({ gpus: null }), { trigger: 'system.facts.request' }))
      .toThrow('require a GPU list');
    expect(() => runGpuMemoryEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported GPU-memory trigger: bad');
    expect(() => runGpuMemoryEngine(facts(), {}))
      .toThrow('Unsupported GPU-memory trigger: unknown');
    expect(() => runGpuMemoryEngine())
      .toThrow('Unsupported GPU-memory trigger: unknown');
    expect(() => runGpuMemoryEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('GPU-memory clock must return a number');
  });
});
