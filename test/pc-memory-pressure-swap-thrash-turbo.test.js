import {
  MEMORY_PRESSURE_SWAP_THRASH_TRIGGERS,
  MEMORY_PRESSURE_SWAP_THRASH_TURBO_ID,
  MEMORY_PRESSURE_SWAP_THRASH_TURBO_VERSION,
  runMemoryPressureSwapThrashTurbo
} from '../pc/engines/memory-pressure/turbos/swap-thrash/turbo.js';

function snapshot(swapUsedPercent, swapInRate = 1, swapOutRate = 1,
  usedPercent = 50, overrides = {}) {
  return {
    engine: 'system-facts',
    memory: { swapUsedPercent, swapInRate, swapOutRate, usedPercent },
    ...overrides
  };
}

describe('Memory-pressure swap-thrash turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(MEMORY_PRESSURE_SWAP_THRASH_TURBO_ID).toBe('memory-pressure.swap-thrash');
    expect(MEMORY_PRESSURE_SWAP_THRASH_TURBO_VERSION).toBe(1);
    expect(MEMORY_PRESSURE_SWAP_THRASH_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(MEMORY_PRESSURE_SWAP_THRASH_TRIGGERS)).toBe(true);
  });

  test('classifies stable, active thrash, reclaim churn, rising, and volatile swap', () => {
    const stable = runMemoryPressureSwapThrashTurbo([
      snapshot(10), snapshot(11), snapshot(11)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(stable).toMatchObject({ sampleCount: 3, observedCount: 3,
      unknownCount: 0, invalidCount: 0, activeCount: 0, reclaimCount: 0,
      growthCount: 0, comparisonCount: 2, reversalCount: 0, slope: 0.5,
      state: 'stable-swap', confidence: 1, recommendations: ['no-change'], actions: [] });

    const active = runMemoryPressureSwapThrashTurbo([
      snapshot(60, 10, 10, 80), snapshot(65, 12, 10, 85)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(active).toMatchObject({ activeCount: 2, reclaimCount: 0,
      state: 'active-thrash', recommendations: ['review-memory-pressure-before-swap-control'] });

    const reclaim = runMemoryPressureSwapThrashTurbo([
      snapshot(20, 10, 10, 50), snapshot(25, 12, 10, 55)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(reclaim).toMatchObject({ activeCount: 0, reclaimCount: 2,
      state: 'reclaim-churn', recommendations: ['observe-reclaim-activity'] });

    const rising = runMemoryPressureSwapThrashTurbo([
      snapshot(10), snapshot(25), snapshot(40)
    ], { trigger: 'health.interval', growthThreshold: 10, now: () => 0 });
    expect(rising).toMatchObject({ growthCount: 2, slope: 15,
      state: 'rising-swap', recommendations: ['observe-swap-growth'] });

    const volatile = runMemoryPressureSwapThrashTurbo([
      snapshot(20), snapshot(40), snapshot(20), snapshot(40)
    ], { trigger: 'health.interval', growthThreshold: 100,
      volatilityThreshold: 10, reversalThreshold: 2, now: () => 0 });
    expect(volatile).toMatchObject({ comparisonCount: 3, reversalCount: 2,
      averageAbsoluteDelta: 20, state: 'volatile-swap',
      recommendations: ['observe-swap-stability'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows, handles sparse evidence, and preserves sensor refusal', () => {
    const empty = runMemoryPressureSwapThrashTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      invalidCount: 0, comparisonCount: 0, averageAbsoluteDelta: 0, slope: null,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-swap-samples'] });

    const insufficient = runMemoryPressureSwapThrashTurbo([snapshot(10)], {
      trigger: 'health.interval', now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const bounded = runMemoryPressureSwapThrashTurbo([
      snapshot(10), snapshot(20), snapshot(30), snapshot(40)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2,
      growthThreshold: 5, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, observedCount: 2, slope: 10 });

    const unknown = runMemoryPressureSwapThrashTurbo([
      snapshot(null, null, null, null), snapshot(10, null, 1, 50)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, invalidCount: 0,
      state: 'no-observation', confidence: 0,
      recommendations: ['request-swap-activity-observation'] });

    const invalid = runMemoryPressureSwapThrashTurbo([
      snapshot(120, -1, 1, 50), snapshot(20, 1, 1, 50)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(invalid).toMatchObject({ observedCount: 1, unknownCount: 0, invalidCount: 1,
      state: 'invalid-swap-evidence', recommendations: ['review-swap-sensor-range'] });
  });

  test('handles equal, sparse, and direction-changing swap movement', () => {
    const movement = runMemoryPressureSwapThrashTurbo([
      snapshot(20), snapshot(20), snapshot(40), snapshot(20)
    ], { trigger: 'health.interval', growthThreshold: 50,
      volatilityThreshold: 100, reversalThreshold: 1, now: () => 0 });
    expect(movement).toMatchObject({ observedCount: 4, comparisonCount: 3,
      growthCount: 0, reversalCount: 1, slope: 0, state: 'volatile-swap' });
  });

  test('rejects malformed inputs, bounds, thresholds, snapshots, and clocks', () => {
    expect(() => runMemoryPressureSwapThrashTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runMemoryPressureSwapThrashTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported memory-pressure swap-thrash trigger: bad');
    expect(() => runMemoryPressureSwapThrashTurbo()).toThrow(
      'Unsupported memory-pressure swap-thrash trigger: unknown'
    );
    expect(() => runMemoryPressureSwapThrashTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPressureSwapThrashTurbo([], {
      trigger: 'health.interval', windowSize: 65
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPressureSwapThrashTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runMemoryPressureSwapThrashTurbo([], {
      trigger: 'health.interval', minimumSamples: 0
    })).toThrow('minimumSamples must fit inside the window');
    for (const option of ['swapUseThreshold', 'memoryPressureThreshold',
      'growthThreshold', 'volatilityThreshold']) {
      expect(() => runMemoryPressureSwapThrashTurbo([], {
        trigger: 'health.interval', [option]: -1
      })).toThrow(`${option} must be between 0 and 100`);
      expect(() => runMemoryPressureSwapThrashTurbo([], {
        trigger: 'health.interval', [option]: 101
      })).toThrow(`${option} must be between 0 and 100`);
    }
    expect(() => runMemoryPressureSwapThrashTurbo([], {
      trigger: 'health.interval', activityThreshold: -1
    })).toThrow('activityThreshold must be between 0 and 1000000000');
    expect(() => runMemoryPressureSwapThrashTurbo([], {
      trigger: 'health.interval', activityThreshold: 1000000001
    })).toThrow('activityThreshold must be between 0 and 1000000000');
    for (const option of ['reversalThreshold', 'activeCountThreshold', 'reclaimCountThreshold']) {
      expect(() => runMemoryPressureSwapThrashTurbo([], {
        trigger: 'health.interval', [option]: 0
      })).toThrow(`${option} must be an integer from 1 to 64`);
      expect(() => runMemoryPressureSwapThrashTurbo([], {
        trigger: 'health.interval', [option]: 65
      })).toThrow(`${option} must be an integer from 1 to 64`);
    }
    expect(() => runMemoryPressureSwapThrashTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runMemoryPressureSwapThrashTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runMemoryPressureSwapThrashTurbo([
      { engine: 'other' }, snapshot(10)
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runMemoryPressureSwapThrashTurbo([
      snapshot(10, 1, 1, 50, { memory: null }), snapshot(10)
    ], { trigger: 'health.interval' })).toThrow('requires a memory section');
  });
});
