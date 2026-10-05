import {
  GPU_THERMAL_MARGIN_TURBO_ID,
  GPU_THERMAL_MARGIN_TURBO_VERSION,
  GPU_THERMAL_MARGIN_TRIGGERS,
  runGpuThermalMarginTurbo
} from '../pc/engines/gpu-utilization/turbos/thermal-margin/turbo.js';

function snapshot(values) {
  return { engine: 'system-facts', gpus: values.map((temperatureCelsius) => ({ temperatureCelsius })) };
}

describe('GPU thermal-margin turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(GPU_THERMAL_MARGIN_TURBO_ID).toBe('gpu-utilization.thermal-margin');
    expect(GPU_THERMAL_MARGIN_TURBO_VERSION).toBe(1);
    expect(GPU_THERMAL_MARGIN_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    const report = runGpuThermalMarginTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(report).toMatchObject({ protocolVersion: 1, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.recommendations)).toBe(true);
    expect(Object.isFrozen(report.actions)).toBe(true);
  });

  test('classifies sustained critical, elevated, and normal thermal margin', () => {
    const critical = runGpuThermalMarginTurbo([
      snapshot([82, 60]), snapshot([84, 70])
    ], { trigger: 'health.interval', now: () => 1 });
    expect(critical).toMatchObject({ observedCount: 2, criticalCount: 2, elevatedCount: 0,
      state: 'sustained-critical-thermal', recommendations: ['hold-unapproved-gpu-policy', 'protect-thermal-headroom'] });

    const elevated = runGpuThermalMarginTurbo([
      snapshot([75, 60]), snapshot([72, 65])
    ], { trigger: 'workload.changed', now: () => 2 });
    expect(elevated).toMatchObject({ criticalCount: 0, elevatedCount: 2,
      state: 'sustained-elevated-thermal', recommendations: ['observe-next-thermal-sample', 'review-thermal-headroom'] });

    const normal = runGpuThermalMarginTurbo([
      snapshot([40, 50]), snapshot([55, 60])
    ], { trigger: 'system.facts.request', now: () => 3 });
    expect(normal).toMatchObject({ criticalCount: 0, elevatedCount: 0,
      state: 'normal-thermal-margin', recommendations: ['no-change'] });
  });

  test('preserves unknown, invalid, and bounded evidence', () => {
    const unknown = runGpuThermalMarginTurbo([
      { engine: 'system-facts', gpus: [] }, { engine: 'system-facts', gpus: [{}] }
    ], { trigger: 'health.interval', now: () => 4 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2,
      state: 'no-observation', recommendations: ['request-gpu-thermal-observation'] });

    const invalid = runGpuThermalMarginTurbo([
      snapshot([151]), snapshot([-51])
    ], { trigger: 'health.interval', now: () => 5 });
    expect(invalid).toMatchObject({ invalidCount: 2, state: 'invalid-thermal-evidence',
      recommendations: ['review-gpu-temperature-sensor-range'] });

    const bounded = runGpuThermalMarginTurbo([
      snapshot([82]), snapshot([82]), snapshot([50])
    ], { trigger: 'health.interval', windowSize: 2, persistenceThreshold: 2, now: () => 6 });
    expect(bounded).toMatchObject({ sampleCount: 2, criticalCount: 1, state: 'normal-thermal-margin' });
  });

  test('rejects malformed snapshots and unsupported input', () => {
    expect(() => runGpuThermalMarginTurbo('bad', { trigger: 'health.interval' })).toThrow(TypeError);
    expect(() => runGpuThermalMarginTurbo([null, snapshot([50])], {
      trigger: 'health.interval', now: () => 7
    })).toThrow(TypeError);
    expect(() => runGpuThermalMarginTurbo([
      { engine: 'wrong', gpus: [] }, snapshot([50])
    ], { trigger: 'health.interval', now: () => 7 })).toThrow(Error);
    expect(() => runGpuThermalMarginTurbo([
      { engine: 'system-facts' }, snapshot([50])
    ], { trigger: 'health.interval', now: () => 7 })).toThrow(TypeError);
  });

  test('rejects unsupported triggers, ranges, and clocks', () => {
    expect(() => runGpuThermalMarginTurbo()).toThrow('Unsupported GPU thermal-margin trigger: unknown');
    expect(() => runGpuThermalMarginTurbo([], { trigger: 'unsupported' }))
      .toThrow('Unsupported GPU thermal-margin trigger');
    expect(() => runGpuThermalMarginTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow(RangeError);
    expect(() => runGpuThermalMarginTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow(RangeError);
    expect(() => runGpuThermalMarginTurbo([], {
      trigger: 'health.interval', windowSize: 4, minimumSamples: 5
    })).toThrow(RangeError);
    expect(() => runGpuThermalMarginTurbo([], { trigger: 'health.interval', criticalMargin: -1 }))
      .toThrow(RangeError);
    expect(() => runGpuThermalMarginTurbo([], { trigger: 'health.interval', elevatedMargin: 101 }))
      .toThrow(RangeError);
    expect(() => runGpuThermalMarginTurbo([], {
      trigger: 'health.interval', criticalMargin: 20, elevatedMargin: 10
    })).toThrow(RangeError);
    expect(() => runGpuThermalMarginTurbo([], { trigger: 'health.interval', thermalLimit: 49 }))
      .toThrow(RangeError);
    expect(() => runGpuThermalMarginTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runGpuThermalMarginTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow(TypeError);
  });
});
