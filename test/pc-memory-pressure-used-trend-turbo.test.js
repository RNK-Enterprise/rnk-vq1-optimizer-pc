import {
  MEMORY_PRESSURE_USED_TREND_TRIGGERS,
  MEMORY_PRESSURE_USED_TREND_TURBO_ID,
  MEMORY_PRESSURE_USED_TREND_TURBO_VERSION,
  runMemoryPressureUsedTrendTurbo
} from '../pc/engines/memory-pressure/turbos/used-trend/turbo.js';

function snapshot(usedPercent, availableBytes = 4096, overrides = {}) {
  return {
    engine: 'system-facts',
    memory: { usedPercent, availableBytes },
    ...overrides
  };
}

describe('Memory-pressure used-trend turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(MEMORY_PRESSURE_USED_TREND_TURBO_ID).toBe('memory-pressure.used-trend');
    expect(MEMORY_PRESSURE_USED_TREND_TURBO_VERSION).toBe(1);
    expect(MEMORY_PRESSURE_USED_TREND_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(MEMORY_PRESSURE_USED_TREND_TRIGGERS)).toBe(true);
  });

  test('classifies stable, high, rising, falling, and volatile pressure', () => {
    const stable = runMemoryPressureUsedTrendTurbo([
      snapshot(50), snapshot(52), snapshot(53)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(stable).toMatchObject({ sampleCount: 3, observedCount: 3,
      unknownCount: 0, invalidCount: 0, highPressureCount: 0, growthCount: 0,
      declineCount: 0, comparisonCount: 2, reversalCount: 0, averageAbsoluteDelta: 1.5,
      slope: 1.5, state: 'stable-pressure', confidence: 1,
      recommendations: ['no-change'], actions: [] });

    const high = runMemoryPressureUsedTrendTurbo([
      snapshot(91), snapshot(92)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(high).toMatchObject({ highPressureCount: 2, state: 'high-pressure',
      recommendations: ['protect-memory-headroom', 'hold-destructive-actions'] });

    const rising = runMemoryPressureUsedTrendTurbo([
      snapshot(40), snapshot(50), snapshot(60)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(rising).toMatchObject({ growthCount: 2, slope: 10,
      state: 'rising-pressure', recommendations: ['observe-memory-growth'] });

    const falling = runMemoryPressureUsedTrendTurbo([
      snapshot(80), snapshot(70), snapshot(60)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(falling).toMatchObject({ declineCount: 2, slope: -10,
      state: 'falling-pressure', recommendations: ['observe-memory-recovery'] });

    const volatile = runMemoryPressureUsedTrendTurbo([
      snapshot(50), snapshot(65), snapshot(50), snapshot(65)
    ], { trigger: 'health.interval', growthDeltaThreshold: 20,
      declineDeltaThreshold: 20, volatilityThreshold: 10, now: () => 0 });
    expect(volatile).toMatchObject({ comparisonCount: 3, reversalCount: 2,
      averageAbsoluteDelta: 15, state: 'volatile-pressure',
      recommendations: ['observe-memory-pressure-stability'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows, handles sparse evidence, and preserves sensor refusal', () => {
    const empty = runMemoryPressureUsedTrendTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      invalidCount: 0, comparisonCount: 0, averageAbsoluteDelta: 0, slope: null,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-memory-samples'] });

    const insufficient = runMemoryPressureUsedTrendTurbo([snapshot(50)], {
      trigger: 'health.interval', now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const bounded = runMemoryPressureUsedTrendTurbo([
      snapshot(40), snapshot(50), snapshot(60), snapshot(70)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, observedCount: 2, slope: 10 });

    const unknown = runMemoryPressureUsedTrendTurbo([
      snapshot(null, -1), snapshot(NaN, 'bad')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, invalidCount: 0,
      state: 'no-observation', confidence: 0,
      recommendations: ['request-memory-pressure-observation'] });

    const invalid = runMemoryPressureUsedTrendTurbo([
      snapshot(120), snapshot(50)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(invalid).toMatchObject({ observedCount: 1, unknownCount: 0, invalidCount: 1,
      highPressureCount: 1, state: 'invalid-pressure-evidence',
      recommendations: ['review-memory-sensor-range'] });

    const normalized = runMemoryPressureUsedTrendTurbo([
      snapshot(-10), snapshot(110)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(normalized).toMatchObject({ observedCount: 0, invalidCount: 2 });
  });

  test('handles equal, sparse, and direction-changing movement', () => {
    const movement = runMemoryPressureUsedTrendTurbo([
      snapshot(50), snapshot(50), snapshot(60), snapshot(50)
    ], { trigger: 'health.interval', growthDeltaThreshold: 5,
      declineDeltaThreshold: 5, volatilityThreshold: 100, reversalThreshold: 1, now: () => 0 });
    expect(movement).toMatchObject({ observedCount: 4, unknownCount: 0,
      comparisonCount: 3, growthCount: 1, declineCount: 1, reversalCount: 1,
      slope: 0, state: 'volatile-pressure' });
  });

  test('rejects malformed inputs, bounds, thresholds, snapshots, and clocks', () => {
    expect(() => runMemoryPressureUsedTrendTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runMemoryPressureUsedTrendTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported memory-pressure used-trend trigger: bad');
    expect(() => runMemoryPressureUsedTrendTurbo()).toThrow(
      'Unsupported memory-pressure used-trend trigger: unknown'
    );
    expect(() => runMemoryPressureUsedTrendTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPressureUsedTrendTurbo([], {
      trigger: 'health.interval', windowSize: 65
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPressureUsedTrendTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runMemoryPressureUsedTrendTurbo([], {
      trigger: 'health.interval', minimumSamples: 0
    })).toThrow('minimumSamples must fit inside the window');
    for (const option of ['highPressureThreshold', 'growthDeltaThreshold',
      'declineDeltaThreshold', 'volatilityThreshold']) {
      expect(() => runMemoryPressureUsedTrendTurbo([], {
        trigger: 'health.interval', [option]: -1
      })).toThrow(`${option} must be between 0 and 100`);
      expect(() => runMemoryPressureUsedTrendTurbo([], {
        trigger: 'health.interval', [option]: 101
      })).toThrow(`${option} must be between 0 and 100`);
    }
    expect(() => runMemoryPressureUsedTrendTurbo([], {
      trigger: 'health.interval', reversalThreshold: 0
    })).toThrow('reversalThreshold must be an integer from 1 to 64');
    expect(() => runMemoryPressureUsedTrendTurbo([], {
      trigger: 'health.interval', reversalThreshold: 65
    })).toThrow('reversalThreshold must be an integer from 1 to 64');
    expect(() => runMemoryPressureUsedTrendTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runMemoryPressureUsedTrendTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runMemoryPressureUsedTrendTurbo([
      { engine: 'other' }, snapshot(50)
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runMemoryPressureUsedTrendTurbo([
      snapshot(50, 4096, { memory: null }), snapshot(50)
    ], { trigger: 'health.interval' })).toThrow('requires a memory section');
  });
});
