import {
  GPU_VRAM_PRESSURE_TURBO_ID,
  GPU_VRAM_PRESSURE_TURBO_VERSION,
  GPU_VRAM_PRESSURE_TRIGGERS,
  runGpuVramPressureTurbo
} from '../pc/engines/gpu-utilization/turbos/vram-pressure/turbo.js';

function snapshot(values) {
  return { engine: 'system-facts', gpus: values.map(([vramBytes, vramUsedBytes]) => ({ vramBytes, vramUsedBytes })) };
}

describe('GPU VRAM-pressure turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(GPU_VRAM_PRESSURE_TURBO_ID).toBe('gpu-utilization.vram-pressure');
    expect(GPU_VRAM_PRESSURE_TURBO_VERSION).toBe(1);
    expect(GPU_VRAM_PRESSURE_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    const report = runGpuVramPressureTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(report).toMatchObject({ protocolVersion: 1, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.recommendations)).toBe(true);
    expect(Object.isFrozen(report.actions)).toBe(true);
  });

  test('classifies critical, elevated, and normal VRAM pressure', () => {
    const critical = runGpuVramPressureTurbo([
      snapshot([[1000, 950], [2000, 1000]]), snapshot([[1000, 920], [2000, 1000]])
    ], { trigger: 'health.interval', now: () => 1 });
    expect(critical).toMatchObject({ observedCount: 2, criticalCount: 2, elevatedCount: 0,
      state: 'sustained-critical-vram', recommendations: ['hold-unapproved-gpu-policy', 'protect-vram-headroom'] });

    const elevated = runGpuVramPressureTurbo([
      snapshot([[1000, 750]]), snapshot([[1000, 800]])
    ], { trigger: 'workload.changed', now: () => 2 });
    expect(elevated).toMatchObject({ criticalCount: 0, elevatedCount: 2,
      state: 'sustained-elevated-vram', recommendations: ['observe-next-vram-sample', 'review-vram-headroom'] });

    const normal = runGpuVramPressureTurbo([
      snapshot([[1000, 200]]), snapshot([[1000, 400]])
    ], { trigger: 'system.facts.request', now: () => 3 });
    expect(normal).toMatchObject({ criticalCount: 0, elevatedCount: 0,
      state: 'normal-vram-pressure', recommendations: ['no-change'] });
  });

  test('preserves no-vram, unknown, invalid, and bounded evidence', () => {
    const none = runGpuVramPressureTurbo([
      snapshot([[0, 0]]), snapshot([[0, 0]])
    ], { trigger: 'health.interval', now: () => 4 });
    expect(none).toMatchObject({ noVramCount: 2, observedCount: 0, unknownCount: 0,
      state: 'no-vram', recommendations: ['no-change', 'keep-vram-controls-disabled'] });

    const unknown = runGpuVramPressureTurbo([
      { engine: 'system-facts', gpus: [] }, snapshot([[undefined, undefined]])
    ], { trigger: 'health.interval', now: () => 5 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, state: 'no-observation',
      recommendations: ['request-gpu-vram-observation'] });

    const invalid = runGpuVramPressureTurbo([
      snapshot([[-1, 0]]), snapshot([[1000, 1200]])
    ], { trigger: 'health.interval', now: () => 6 });
    expect(invalid).toMatchObject({ invalidCount: 2, state: 'invalid-vram-evidence',
      recommendations: ['review-gpu-vram-sensor-range'] });

    const bounded = runGpuVramPressureTurbo([
      snapshot([[1000, 950]]), snapshot([[1000, 950]]), snapshot([[1000, 200]])
    ], { trigger: 'health.interval', windowSize: 2, persistenceThreshold: 2, now: () => 7 });
    expect(bounded).toMatchObject({ sampleCount: 2, criticalCount: 1, state: 'normal-vram-pressure' });
  });

  test('rejects malformed snapshots and unsupported input', () => {
    expect(() => runGpuVramPressureTurbo('bad', { trigger: 'health.interval' })).toThrow(TypeError);
    expect(() => runGpuVramPressureTurbo([null, snapshot([[1000, 500]])], {
      trigger: 'health.interval', now: () => 8
    })).toThrow(TypeError);
    expect(() => runGpuVramPressureTurbo([
      { engine: 'wrong', gpus: [] }, snapshot([[1000, 500]])
    ], { trigger: 'health.interval', now: () => 8 })).toThrow(Error);
    expect(() => runGpuVramPressureTurbo([
      { engine: 'system-facts' }, snapshot([[1000, 500]])
    ], { trigger: 'health.interval', now: () => 8 })).toThrow(TypeError);
  });

  test('rejects unsupported triggers, ranges, and clocks', () => {
    expect(() => runGpuVramPressureTurbo()).toThrow('Unsupported GPU VRAM-pressure trigger: unknown');
    expect(() => runGpuVramPressureTurbo([], { trigger: 'unsupported' }))
      .toThrow('Unsupported GPU VRAM-pressure trigger');
    expect(() => runGpuVramPressureTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow(RangeError);
    expect(() => runGpuVramPressureTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow(RangeError);
    expect(() => runGpuVramPressureTurbo([], {
      trigger: 'health.interval', windowSize: 4, minimumSamples: 5
    })).toThrow(RangeError);
    expect(() => runGpuVramPressureTurbo([], { trigger: 'health.interval', criticalThreshold: -1 }))
      .toThrow(RangeError);
    expect(() => runGpuVramPressureTurbo([], { trigger: 'health.interval', elevatedThreshold: 101 }))
      .toThrow(RangeError);
    expect(() => runGpuVramPressureTurbo([], {
      trigger: 'health.interval', criticalThreshold: 60, elevatedThreshold: 70
    })).toThrow(RangeError);
    expect(() => runGpuVramPressureTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runGpuVramPressureTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow(TypeError);
  });
});
