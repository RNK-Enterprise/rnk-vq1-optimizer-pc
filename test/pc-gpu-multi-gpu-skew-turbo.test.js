import {
  GPU_MULTI_GPU_SKEW_TURBO_ID,
  GPU_MULTI_GPU_SKEW_TURBO_VERSION,
  GPU_MULTI_GPU_SKEW_TRIGGERS,
  runGpuMultiGpuSkewTurbo
} from '../pc/engines/gpu-utilization/turbos/multi-gpu-skew/turbo.js';

function snapshot(values) {
  return { engine: 'system-facts', gpus: values.map((utilizationPercent) => ({ utilizationPercent })) };
}

describe('GPU multi-gpu-skew turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(GPU_MULTI_GPU_SKEW_TURBO_ID).toBe('gpu-utilization.multi-gpu-skew');
    expect(GPU_MULTI_GPU_SKEW_TURBO_VERSION).toBe(1);
    expect(GPU_MULTI_GPU_SKEW_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    const report = runGpuMultiGpuSkewTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(report).toMatchObject({ protocolVersion: 1, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.recommendations)).toBe(true);
    expect(Object.isFrozen(report.actions)).toBe(true);
  });

  test('classifies sustained skew, observed skew, and balanced layouts', () => {
    const sustained = runGpuMultiGpuSkewTurbo([
      snapshot([95, 20]), snapshot([90, 10])
    ], { trigger: 'health.interval', now: () => 1 });
    expect(sustained).toMatchObject({ observedCount: 2, skewCount: 2, balancedCount: 0,
      state: 'sustained-skew', recommendations: ['review-gpu-workload-distribution', 'hold-unapproved-gpu-policy'] });

    const observed = runGpuMultiGpuSkewTurbo([
      snapshot([90, 20]), snapshot([40, 45])
    ], { trigger: 'workload.changed', now: () => 2 });
    expect(observed).toMatchObject({ skewCount: 1, balancedCount: 1,
      state: 'skew-observed', recommendations: ['observe-next-gpu-layout-sample'] });

    const balanced = runGpuMultiGpuSkewTurbo([
      snapshot([40, 50]), snapshot([60, 70])
    ], { trigger: 'system.facts.request', now: () => 3 });
    expect(balanced).toMatchObject({ skewCount: 0, balancedCount: 2,
      state: 'balanced-gpu-layout', recommendations: ['no-change'] });
  });

  test('preserves no-GPU, unknown, invalid, and bounded evidence', () => {
    const noGpu = runGpuMultiGpuSkewTurbo([
      { engine: 'system-facts', gpus: [] }, { engine: 'system-facts', gpus: [] }
    ], { trigger: 'health.interval', now: () => 4 });
    expect(noGpu).toMatchObject({ noGpuCount: 2, observedCount: 0, unknownCount: 0,
      state: 'no-gpu', recommendations: ['no-change', 'keep-gpu-controls-disabled'] });

    const unknown = runGpuMultiGpuSkewTurbo([
      { engine: 'system-facts', gpus: [{}] }, { engine: 'system-facts', gpus: [{}] }
    ], { trigger: 'health.interval', now: () => 5 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, state: 'no-observation',
      recommendations: ['request-gpu-skew-observation'] });

    const invalid = runGpuMultiGpuSkewTurbo([
      snapshot([101, 20]), snapshot([-1, 20])
    ], { trigger: 'health.interval', now: () => 6 });
    expect(invalid).toMatchObject({ invalidCount: 2, state: 'invalid-skew-evidence',
      recommendations: ['review-gpu-utilization-sensor-range'] });

    const bounded = runGpuMultiGpuSkewTurbo([
      snapshot([90, 10]), snapshot([90, 10]), snapshot([40, 40])
    ], { trigger: 'health.interval', windowSize: 2, persistenceThreshold: 2, now: () => 7 });
    expect(bounded).toMatchObject({ sampleCount: 2, skewCount: 1, state: 'skew-observed' });
  });

  test('rejects malformed snapshots and unsupported input', () => {
    expect(() => runGpuMultiGpuSkewTurbo('bad', { trigger: 'health.interval' })).toThrow(TypeError);
    expect(() => runGpuMultiGpuSkewTurbo([null, snapshot([20, 20])], {
      trigger: 'health.interval', now: () => 8
    })).toThrow(TypeError);
    expect(() => runGpuMultiGpuSkewTurbo([
      { engine: 'wrong', gpus: [] }, snapshot([20, 20])
    ], { trigger: 'health.interval', now: () => 8 })).toThrow(Error);
    expect(() => runGpuMultiGpuSkewTurbo([
      { engine: 'system-facts' }, snapshot([20, 20])
    ], { trigger: 'health.interval', now: () => 8 })).toThrow(TypeError);
  });

  test('rejects unsupported triggers, ranges, and clocks', () => {
    expect(() => runGpuMultiGpuSkewTurbo()).toThrow('Unsupported GPU multi-gpu-skew trigger: unknown');
    expect(() => runGpuMultiGpuSkewTurbo([], { trigger: 'unsupported' }))
      .toThrow('Unsupported GPU multi-gpu-skew trigger');
    expect(() => runGpuMultiGpuSkewTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow(RangeError);
    expect(() => runGpuMultiGpuSkewTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow(RangeError);
    expect(() => runGpuMultiGpuSkewTurbo([], {
      trigger: 'health.interval', windowSize: 4, minimumSamples: 5
    })).toThrow(RangeError);
    expect(() => runGpuMultiGpuSkewTurbo([], { trigger: 'health.interval', skewThreshold: -1 }))
      .toThrow(RangeError);
    expect(() => runGpuMultiGpuSkewTurbo([], { trigger: 'health.interval', skewThreshold: 101 }))
      .toThrow(RangeError);
    expect(() => runGpuMultiGpuSkewTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runGpuMultiGpuSkewTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow(TypeError);
  });
});
