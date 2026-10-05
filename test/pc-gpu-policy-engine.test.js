import {
  GPU_POLICY_ENGINE_ID,
  GPU_POLICY_ENGINE_VERSION,
  GPU_POLICY_TRIGGERS,
  runGpuPolicyEngine
} from '../pc/engines/gpu-policy/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { gpuObservation: true },
    gpus: [{ vendor: 'NVIDIA', model: 'Test GPU', driver: 'nvidia' }],
    ...overrides
  };
}

describe('GPU-policy engine', () => {
  test('publishes identity and triggers', () => {
    expect(GPU_POLICY_ENGINE_ID).toBe('gpu-policy');
    expect(GPU_POLICY_ENGINE_VERSION).toBe(1);
    expect(GPU_POLICY_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(GPU_POLICY_TRIGGERS)).toBe(true);
  });

  test('reports documented GPU policy evidence without change', () => {
    const result = runGpuPolicyEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: GPU_POLICY_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      gpuCount: 1,
      evidence: 'documented',
      vendors: ['NVIDIA'],
      models: ['Test GPU'],
      drivers: ['nvidia'],
      observationEnabled: true,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('recognizes incomplete and vendor-specific evidence', () => {
    expect(runGpuPolicyEngine(facts({ gpus: [{ vendor: 'NVIDIA', model: 'GPU' }] }), {
      trigger: 'workload.changed',
      now: () => 0
    })).toMatchObject({
      evidence: 'incomplete',
      state: 'observation-required',
      recommendations: ['request-gpu-policy-observation']
    });
    expect(runGpuPolicyEngine(facts({ gpus: [{ vendor: 'Acme', model: 'GPU', driver: 'acme-driver' }] }), {
      trigger: 'health.interval',
      now: () => 0
    })).toMatchObject({
      evidence: 'vendor-specific',
      state: 'vendor-review',
      recommendations: ['review-documented-driver-controls']
    });
    expect(runGpuPolicyEngine(facts({
      gpus: [{ vendor: 'NVIDIA', model: 'GPU', driver: 'acme-driver' }]
    }), {
      trigger: 'health.interval',
      now: () => 0
    })).toMatchObject({
      evidence: 'vendor-specific',
      state: 'vendor-review'
    });
  });

  test('handles multiple documented vendors and disabled observation', () => {
    expect(runGpuPolicyEngine(facts({
      capabilities: { gpuObservation: false },
      gpus: [
        { vendor: 'AMD', model: 'A', driver: 'amdgpu' },
        { vendor: 'Intel', model: 'B', driver: 'i915' },
        { vendor: 'intel_arc', model: 'C', driver: 'i915' }
      ]
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      gpuCount: 3,
      evidence: 'documented',
      observationEnabled: false,
      state: 'observation-disabled',
      recommendations: ['keep-gpu-observation-disabled']
    });
  });

  test('treats no-GPU and unknown environments conservatively', () => {
    expect(runGpuPolicyEngine(facts({
      environment: 'headless',
      gpus: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      gpuCount: 0,
      evidence: 'none',
      state: 'no-gpu',
      recommendations: ['keep-gpu-controls-disabled']
    });
    expect(runGpuPolicyEngine(facts({
      environment: 'other',
      gpus: [{ vendor: 'NVIDIA', model: 'GPU', driver: 'nvidia' }]
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      recommendations: ['request-environment-profile']
    });
  });

  test('filters malformed GPU rows and rejects malformed inputs', () => {
    expect(runGpuPolicyEngine(facts({ gpus: [null, {
      vendor: 'NVIDIA', model: 'GPU', driver: 'nvidia'
    }] }), { trigger: 'system.facts.request', now: () => 0 }).gpuCount).toBe(1);
    expect(() => runGpuPolicyEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runGpuPolicyEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runGpuPolicyEngine(facts({ gpus: null }), { trigger: 'system.facts.request' }))
      .toThrow('require a GPU list');
    expect(() => runGpuPolicyEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported GPU-policy trigger: bad');
    expect(() => runGpuPolicyEngine(facts(), {}))
      .toThrow('Unsupported GPU-policy trigger: unknown');
    expect(() => runGpuPolicyEngine())
      .toThrow('Unsupported GPU-policy trigger: unknown');
    expect(() => runGpuPolicyEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('GPU-policy clock must return a number');
  });
});
