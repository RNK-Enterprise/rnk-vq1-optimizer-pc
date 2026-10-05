import {
  MEMORY_PRESSURE_HEADROOM_VOLATILITY_TRIGGERS,
  MEMORY_PRESSURE_HEADROOM_VOLATILITY_TURBO_ID,
  MEMORY_PRESSURE_HEADROOM_VOLATILITY_TURBO_VERSION,
  runMemoryPressureHeadroomVolatilityTurbo
} from '../pc/engines/memory-pressure/turbos/headroom-volatility/turbo.js';

function snapshot(usedPercent, availableBytes = 500, totalBytes = 1000, overrides = {}) {
  return {
    engine: 'system-facts',
    memory: { usedPercent, availableBytes, totalBytes },
    ...overrides
  };
}

describe('Memory-pressure headroom-volatility turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(MEMORY_PRESSURE_HEADROOM_VOLATILITY_TURBO_ID).toBe('memory-pressure.headroom-volatility');
    expect(MEMORY_PRESSURE_HEADROOM_VOLATILITY_TURBO_VERSION).toBe(1);
    expect(MEMORY_PRESSURE_HEADROOM_VOLATILITY_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(MEMORY_PRESSURE_HEADROOM_VOLATILITY_TRIGGERS)).toBe(true);
  });

  test('classifies stable, low, volatile, and shrinking headroom', () => {
    const stable = runMemoryPressureHeadroomVolatilityTurbo([
      snapshot(50), snapshot(51), snapshot(50)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(stable).toMatchObject({ sampleCount: 3, observedCount: 3,
      unknownCount: 0, invalidCount: 0, lowHeadroomCount: 0,
      meanHeadroom: 49.6667, minimumHeadroom: 49, maximumHeadroom: 50,
      headroomRange: 1, standardDeviation: 0.4714, slope: 0,
      state: 'stable-headroom', confidence: 1, recommendations: ['no-change'], actions: [] });

    const low = runMemoryPressureHeadroomVolatilityTurbo([
      snapshot(90, 50), snapshot(92, 50)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(low).toMatchObject({ lowHeadroomCount: 2, state: 'low-headroom',
      recommendations: ['protect-memory-headroom', 'hold-destructive-actions'] });

    const volatile = runMemoryPressureHeadroomVolatilityTurbo([
      snapshot(20), snapshot(80), snapshot(20), snapshot(80)
    ], { trigger: 'workload.changed', standardDeviationThreshold: 10,
      rangeThreshold: 25, now: () => 0 });
    expect(volatile).toMatchObject({ headroomRange: 60, standardDeviation: 30,
      state: 'volatile-headroom', recommendations: ['observe-memory-headroom-stability'] });

    const shrinking = runMemoryPressureHeadroomVolatilityTurbo([
      snapshot(40), snapshot(50), snapshot(60)
    ], { trigger: 'health.interval', standardDeviationThreshold: 20,
      rangeThreshold: 25, shrinkThreshold: 5, now: () => 0 });
    expect(shrinking).toMatchObject({ slope: -10, headroomRange: 20,
      state: 'shrinking-headroom', recommendations: ['observe-memory-headroom-decline'] });
    expect(Object.isFrozen(stable)).toBe(true);
    expect(Object.isFrozen(stable.actions)).toBe(true);
  });

  test('bounds windows, handles sparse evidence, and preserves sensor refusal', () => {
    const empty = runMemoryPressureHeadroomVolatilityTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      invalidCount: 0, meanHeadroom: null, minimumHeadroom: null, maximumHeadroom: null,
      headroomRange: 0, standardDeviation: 0, slope: null, state: 'insufficient-data',
      confidence: 0, recommendations: ['collect-more-headroom-samples'] });

    const insufficient = runMemoryPressureHeadroomVolatilityTurbo([snapshot(50)], {
      trigger: 'health.interval', now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const bounded = runMemoryPressureHeadroomVolatilityTurbo([
      snapshot(20), snapshot(40), snapshot(60), snapshot(80)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2,
      standardDeviationThreshold: 100, rangeThreshold: 100, shrinkThreshold: 5, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, observedCount: 2, slope: -20 });

    const unknown = runMemoryPressureHeadroomVolatilityTurbo([
      snapshot(null, null, null), snapshot(null, null, 0)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, invalidCount: 0,
      state: 'no-observation', confidence: 0,
      recommendations: ['request-memory-headroom-observation'] });

    const invalid = runMemoryPressureHeadroomVolatilityTurbo([
      snapshot(120, 1200, 1000), snapshot(50)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(invalid).toMatchObject({ observedCount: 1, unknownCount: 0, invalidCount: 1,
      state: 'invalid-headroom-evidence', recommendations: ['review-memory-sensor-range'] });

    const normalized = runMemoryPressureHeadroomVolatilityTurbo([
      snapshot(-10, -1, 1000), snapshot(110, 100, 1000)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(normalized).toMatchObject({ observedCount: 0, invalidCount: 2 });
  });

  test('handles available-ratio margins and zero-span references', () => {
    const ratioLow = runMemoryPressureHeadroomVolatilityTurbo([
      snapshot(50, 50, 1000), snapshot(50, 50, 1000)
    ], { trigger: 'health.interval', lowHeadroomThreshold: 5,
      lowAvailableRatioThreshold: 10, now: () => 0 });
    expect(ratioLow).toMatchObject({ lowHeadroomCount: 2, state: 'low-headroom' });

    const zeroSpan = runMemoryPressureHeadroomVolatilityTurbo([
      snapshot(50, 0, 0), snapshot(50, 0, 0)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(zeroSpan).toMatchObject({ observedCount: 2, lowHeadroomCount: 0,
      state: 'stable-headroom' });
  });

  test('rejects malformed inputs, bounds, thresholds, snapshots, and clocks', () => {
    expect(() => runMemoryPressureHeadroomVolatilityTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runMemoryPressureHeadroomVolatilityTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported memory-pressure headroom-volatility trigger: bad');
    expect(() => runMemoryPressureHeadroomVolatilityTurbo()).toThrow(
      'Unsupported memory-pressure headroom-volatility trigger: unknown'
    );
    expect(() => runMemoryPressureHeadroomVolatilityTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPressureHeadroomVolatilityTurbo([], {
      trigger: 'health.interval', windowSize: 65
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPressureHeadroomVolatilityTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runMemoryPressureHeadroomVolatilityTurbo([], {
      trigger: 'health.interval', minimumSamples: 0
    })).toThrow('minimumSamples must fit inside the window');
    for (const option of ['lowHeadroomThreshold', 'lowAvailableRatioThreshold',
      'standardDeviationThreshold', 'rangeThreshold', 'shrinkThreshold']) {
      expect(() => runMemoryPressureHeadroomVolatilityTurbo([], {
        trigger: 'health.interval', [option]: -1
      })).toThrow(`${option} must be between 0 and 100`);
      expect(() => runMemoryPressureHeadroomVolatilityTurbo([], {
        trigger: 'health.interval', [option]: 101
      })).toThrow(`${option} must be between 0 and 100`);
    }
    expect(() => runMemoryPressureHeadroomVolatilityTurbo([], {
      trigger: 'health.interval', lowCountThreshold: 0
    })).toThrow('lowCountThreshold must be an integer from 1 to 64');
    expect(() => runMemoryPressureHeadroomVolatilityTurbo([], {
      trigger: 'health.interval', lowCountThreshold: 65
    })).toThrow('lowCountThreshold must be an integer from 1 to 64');
    expect(() => runMemoryPressureHeadroomVolatilityTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runMemoryPressureHeadroomVolatilityTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runMemoryPressureHeadroomVolatilityTurbo([
      { engine: 'other' }, snapshot(50)
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runMemoryPressureHeadroomVolatilityTurbo([
      snapshot(50, 500, 1000, { memory: null }), snapshot(50)
    ], { trigger: 'health.interval' })).toThrow('requires a memory section');
  });
});
