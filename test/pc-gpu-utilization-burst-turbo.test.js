import {
  GPU_UTILIZATION_BURST_TURBO_ID,
  GPU_UTILIZATION_BURST_TURBO_VERSION,
  GPU_UTILIZATION_BURST_TRIGGERS,
  runGpuUtilizationBurstTurbo
} from '../pc/engines/gpu-utilization/turbos/utilization-burst/turbo.js';

function snapshot(values) {
  return { engine: 'system-facts', gpus: values.map((utilizationPercent) => ({ utilizationPercent })) };
}

describe('GPU utilization-burst turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(GPU_UTILIZATION_BURST_TURBO_ID).toBe('gpu-utilization.utilization-burst');
    expect(GPU_UTILIZATION_BURST_TURBO_VERSION).toBe(1);
    expect(GPU_UTILIZATION_BURST_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    const report = runGpuUtilizationBurstTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(report).toMatchObject({ protocolVersion: 1, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.recommendations)).toBe(true);
    expect(Object.isFrozen(report.actions)).toBe(true);
  });

  test('classifies sustained, observed, and normal utilization', () => {
    const sustained = runGpuUtilizationBurstTurbo([
      snapshot([95, 40]), snapshot([92, 60])
    ], { trigger: 'health.interval', now: () => 1 });
    expect(sustained).toMatchObject({ observedCount: 2, burstCount: 2, normalCount: 0,
      state: 'sustained-burst', recommendations: ['protect-foreground-or-services', 'hold-unapproved-gpu-policy'] });

    const observed = runGpuUtilizationBurstTurbo([
      snapshot([95]), snapshot([40])
    ], { trigger: 'workload.changed', now: () => 2 });
    expect(observed).toMatchObject({ burstCount: 1, normalCount: 1,
      state: 'burst-observed', recommendations: ['observe-next-gpu-sample'] });

    const normal = runGpuUtilizationBurstTurbo([
      snapshot([10, 60]), snapshot([20, 70])
    ], { trigger: 'system.facts.request', now: () => 3 });
    expect(normal).toMatchObject({ burstCount: 0, normalCount: 2,
      state: 'normal-utilization', recommendations: ['no-change'] });
  });

  test('preserves unknown, invalid, and bounded evidence', () => {
    const unknown = runGpuUtilizationBurstTurbo([
      { engine: 'system-facts', gpus: [] }, { engine: 'system-facts', gpus: [{}] }
    ], { trigger: 'health.interval', now: () => 4 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2,
      state: 'no-observation', recommendations: ['request-gpu-utilization-observation'] });

    const invalid = runGpuUtilizationBurstTurbo([
      snapshot([101]), snapshot([-1])
    ], { trigger: 'health.interval', now: () => 5 });
    expect(invalid).toMatchObject({ invalidCount: 2, state: 'invalid-utilization-evidence',
      recommendations: ['review-gpu-utilization-sensor-range'] });

    const bounded = runGpuUtilizationBurstTurbo([
      snapshot([95]), snapshot([95]), snapshot([20])
    ], { trigger: 'health.interval', windowSize: 2, burstSampleThreshold: 2, now: () => 6 });
    expect(bounded).toMatchObject({ sampleCount: 2, burstCount: 1, state: 'burst-observed' });
  });

  test('rejects malformed snapshots and unsupported input', () => {
    expect(() => runGpuUtilizationBurstTurbo('bad', { trigger: 'health.interval' })).toThrow(TypeError);
    expect(() => runGpuUtilizationBurstTurbo([null, snapshot([20])], {
      trigger: 'health.interval', now: () => 7
    })).toThrow(TypeError);
    expect(() => runGpuUtilizationBurstTurbo([
      { engine: 'wrong', gpus: [] }, snapshot([20])
    ], { trigger: 'health.interval', now: () => 7 })).toThrow(Error);
    expect(() => runGpuUtilizationBurstTurbo([
      { engine: 'system-facts' }, snapshot([20])
    ], { trigger: 'health.interval', now: () => 7 })).toThrow(TypeError);
  });

  test('rejects unsupported triggers, ranges, and clocks', () => {
    expect(() => runGpuUtilizationBurstTurbo()).toThrow('Unsupported GPU utilization-burst trigger: unknown');
    expect(() => runGpuUtilizationBurstTurbo([], { trigger: 'unsupported' }))
      .toThrow('Unsupported GPU utilization-burst trigger');
    expect(() => runGpuUtilizationBurstTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow(RangeError);
    expect(() => runGpuUtilizationBurstTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow(RangeError);
    expect(() => runGpuUtilizationBurstTurbo([], {
      trigger: 'health.interval', windowSize: 4, minimumSamples: 5
    })).toThrow(RangeError);
    expect(() => runGpuUtilizationBurstTurbo([], { trigger: 'health.interval', burstThreshold: -1 }))
      .toThrow(RangeError);
    expect(() => runGpuUtilizationBurstTurbo([], { trigger: 'health.interval', burstThreshold: 101 }))
      .toThrow(RangeError);
    expect(() => runGpuUtilizationBurstTurbo([], { trigger: 'health.interval', burstSampleThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runGpuUtilizationBurstTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow(TypeError);
  });
});
