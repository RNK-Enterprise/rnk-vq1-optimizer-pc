import {
  GPU_DRIVER_DRIFT_TURBO_ID,
  GPU_DRIVER_DRIFT_TURBO_VERSION,
  GPU_DRIVER_DRIFT_TRIGGERS,
  runGpuDriverDriftTurbo
} from '../pc/engines/gpu-policy/turbos/driver-drift/turbo.js';

function snapshot(drivers) {
  return { engine: 'system-facts', gpus: drivers.map((driver) => ({ driver })) };
}

describe('GPU driver-drift turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(GPU_DRIVER_DRIFT_TURBO_ID).toBe('gpu-policy.driver-drift');
    expect(GPU_DRIVER_DRIFT_TURBO_VERSION).toBe(1);
    expect(GPU_DRIVER_DRIFT_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    const report = runGpuDriverDriftTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(report).toMatchObject({ protocolVersion: 1, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.recommendations)).toBe(true);
    expect(Object.isFrozen(report.actions)).toBe(true);
  });

  test('classifies documented stability, drift, and vendor-specific evidence', () => {
    const stable = runGpuDriverDriftTurbo([
      snapshot(['nvidia']), snapshot(['nvidia'])
    ], { trigger: 'health.interval', now: () => 1 });
    expect(stable).toMatchObject({ observedCount: 2, changeCount: 0,
      state: 'documented-driver-stable', recommendations: ['no-change'] });

    const drift = runGpuDriverDriftTurbo([
      snapshot(['nvidia']), snapshot(['amdgpu'])
    ], { trigger: 'workload.changed', now: () => 2 });
    expect(drift).toMatchObject({ changeCount: 1, comparisonCount: 1,
      state: 'driver-drift', recommendations: ['review-driver-change', 'hold-driver-automation'] });

    const vendorSpecific = runGpuDriverDriftTurbo([
      snapshot(['custom-driver']), snapshot(['custom-driver'])
    ], { trigger: 'system.facts.request', now: () => 3 });
    expect(vendorSpecific).toMatchObject({ reviewCount: 1,
      state: 'vendor-specific-driver', recommendations: ['review-documented-driver-controls-without-change'] });
  });

  test('preserves no-GPU, incomplete, unknown, and bounded evidence', () => {
    const noGpu = runGpuDriverDriftTurbo([
      { engine: 'system-facts', gpus: [] }, { engine: 'system-facts', gpus: [] }
    ], { trigger: 'health.interval', now: () => 4 });
    expect(noGpu).toMatchObject({ noGpuCount: 2, observedCount: 0,
      state: 'no-gpu', recommendations: ['keep-gpu-controls-disabled'] });

    const incomplete = runGpuDriverDriftTurbo([
      snapshot([undefined]), snapshot(['nvidia'])
    ], { trigger: 'health.interval', now: () => 5 });
    expect(incomplete).toMatchObject({ incompleteCount: 1, state: 'incomplete-driver-evidence',
      recommendations: ['request-complete-driver-evidence'] });

    const unknown = runGpuDriverDriftTurbo([
      { engine: 'system-facts', gpus: [{}] }, { engine: 'system-facts', gpus: [{}] }
    ], { trigger: 'health.interval', now: () => 6 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, state: 'no-observation' });

    const bounded = runGpuDriverDriftTurbo([
      snapshot(['nvidia']), snapshot(['amdgpu']), snapshot(['nvidia'])
    ], { trigger: 'health.interval', windowSize: 2, changeThreshold: 1, now: () => 7 });
    expect(bounded).toMatchObject({ sampleCount: 2, changeCount: 1, state: 'driver-drift' });
  });

  test('rejects malformed snapshots and unsupported input', () => {
    expect(() => runGpuDriverDriftTurbo('bad', { trigger: 'health.interval' })).toThrow(TypeError);
    expect(() => runGpuDriverDriftTurbo([null, snapshot(['nvidia'])], {
      trigger: 'health.interval', now: () => 8
    })).toThrow(TypeError);
    expect(() => runGpuDriverDriftTurbo([
      { engine: 'wrong', gpus: [] }, snapshot(['nvidia'])
    ], { trigger: 'health.interval', now: () => 8 })).toThrow(Error);
    expect(() => runGpuDriverDriftTurbo([
      { engine: 'system-facts' }, snapshot(['nvidia'])
    ], { trigger: 'health.interval', now: () => 8 })).toThrow(TypeError);
  });

  test('rejects unsupported triggers, ranges, and clocks', () => {
    expect(() => runGpuDriverDriftTurbo()).toThrow('Unsupported GPU driver-drift trigger: unknown');
    expect(() => runGpuDriverDriftTurbo([], { trigger: 'unsupported' }))
      .toThrow('Unsupported GPU driver-drift trigger');
    expect(() => runGpuDriverDriftTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow(RangeError);
    expect(() => runGpuDriverDriftTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow(RangeError);
    expect(() => runGpuDriverDriftTurbo([], {
      trigger: 'health.interval', windowSize: 4, minimumSamples: 5
    })).toThrow(RangeError);
    expect(() => runGpuDriverDriftTurbo([], { trigger: 'health.interval', changeThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runGpuDriverDriftTurbo([], { trigger: 'health.interval', changeThreshold: 65 }))
      .toThrow(RangeError);
    expect(() => runGpuDriverDriftTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow(TypeError);
  });
});
