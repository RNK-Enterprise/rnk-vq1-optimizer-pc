import {
  CPU_UTILIZATION_BURST_TRIGGERS,
  CPU_UTILIZATION_BURST_TURBO_ID,
  CPU_UTILIZATION_BURST_TURBO_VERSION,
  runCpuUtilizationBurstWindowTurbo
} from '../pc/engines/cpu-utilization/turbos/burst-window/turbo.js';

function snapshot(utilizationPercent, overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: { utilizationPercent },
    ...overrides
  };
}

describe('CPU-utilization burst-window turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_UTILIZATION_BURST_TURBO_ID).toBe('cpu-utilization.burst-window');
    expect(CPU_UTILIZATION_BURST_TURBO_VERSION).toBe(1);
    expect(CPU_UTILIZATION_BURST_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_UTILIZATION_BURST_TRIGGERS)).toBe(true);
  });

  test('classifies stable, burst, and rising windows without actions', () => {
    const stable = runCpuUtilizationBurstWindowTurbo([
      snapshot(10), snapshot(20), snapshot(30), snapshot(40)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(stable).toMatchObject({
      turbo: CPU_UTILIZATION_BURST_TURBO_ID, sampleCount: 4, observedCount: 4,
      burstCount: 0, burstRate: 0, peakUtilizationPercent: 40,
      meanUtilizationPercent: 25, maximumRisePercent: 10, state: 'stable-window',
      confidence: 1, recommendations: ['no-change'], actions: []
    });
    const burst = runCpuUtilizationBurstWindowTurbo([
      snapshot(80), snapshot(90), snapshot(95), snapshot(20)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(burst).toMatchObject({ burstCount: 3, burstRate: 0.75, peakUtilizationPercent: 95,
      state: 'burst-detected', recommendations: ['observe-burst-duration', 'hold-unapproved-policy-change'] });
    const rising = runCpuUtilizationBurstWindowTurbo([
      snapshot(10), snapshot(35), snapshot(50), snapshot(55)
    ], { trigger: 'system.facts.request', burstThreshold: 90, now: () => 0 });
    expect(rising).toMatchObject({ burstCount: 0, maximumRisePercent: 25,
      state: 'rising-burst', recommendations: ['observe-next-cpu-sample'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows and preserves sparse, empty, and insufficient evidence', () => {
    const empty = runCpuUtilizationBurstWindowTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-cpu-samples'] });
    const bounded = runCpuUtilizationBurstWindowTurbo([
      snapshot(1), snapshot(2), snapshot(3), snapshot(4), snapshot(5)
    ], { trigger: 'health.interval', windowSize: 3, minimumSamples: 3, now: () => 0 });
    expect(bounded.sampleCount).toBe(3);
    expect(bounded.peakUtilizationPercent).toBe(5);
    const insufficient = runCpuUtilizationBurstWindowTurbo([snapshot(50)], {
      trigger: 'health.interval', minimumSamples: 2, now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5,
      recommendations: ['collect-more-cpu-samples'] });
    const unknown = runCpuUtilizationBurstWindowTurbo([
      snapshot('bad'), snapshot(null)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, burstCount: 0, peakUtilizationPercent: null,
      meanUtilizationPercent: null, state: 'no-observation', confidence: 0,
      recommendations: ['request-cpu-utilization-observation'] });
    const sparse = runCpuUtilizationBurstWindowTurbo([
      snapshot(null), snapshot(120), snapshot(-10)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(sparse).toMatchObject({ observedCount: 2, peakUtilizationPercent: 100,
      meanUtilizationPercent: 50, burstRate: 0.3333 });
  });

  test('rejects malformed inputs, limits, thresholds, and clocks', () => {
    expect(() => runCpuUtilizationBurstWindowTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuUtilizationBurstWindowTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-utilization burst-window trigger: bad');
    expect(() => runCpuUtilizationBurstWindowTurbo([], {}))
      .toThrow('Unsupported CPU-utilization burst-window trigger: unknown');
    expect(() => runCpuUtilizationBurstWindowTurbo())
      .toThrow('Unsupported CPU-utilization burst-window trigger: unknown');
    expect(() => runCpuUtilizationBurstWindowTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuUtilizationBurstWindowTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuUtilizationBurstWindowTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuUtilizationBurstWindowTurbo([], {
      trigger: 'health.interval', burstThreshold: 101
    })).toThrow('burstThreshold must be between 0 and 100');
    expect(() => runCpuUtilizationBurstWindowTurbo([], {
      trigger: 'health.interval', burstRateThreshold: 1.1
    })).toThrow('burstRateThreshold must be between 0 and 1');
    expect(() => runCpuUtilizationBurstWindowTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuUtilizationBurstWindowTurbo([null, null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runCpuUtilizationBurstWindowTurbo([
      { engine: 'other' }, { engine: 'other' }
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuUtilizationBurstWindowTurbo([
      snapshot(10, { cpu: null }), snapshot(10, { cpu: null })
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
