import {
  MEMORY_PRESSURE_OOM_MARGIN_TRIGGERS,
  MEMORY_PRESSURE_OOM_MARGIN_TURBO_ID,
  MEMORY_PRESSURE_OOM_MARGIN_TURBO_VERSION,
  runMemoryPressureOomMarginTurbo
} from '../pc/engines/memory-pressure/turbos/oom-margin/turbo.js';

function snapshot(usedPercent, availableBytes = 500, totalBytes = 1000, overrides = {}) {
  return {
    engine: 'system-facts',
    memory: { usedPercent, availableBytes, totalBytes },
    ...overrides
  };
}

describe('Memory-pressure oom-margin turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(MEMORY_PRESSURE_OOM_MARGIN_TURBO_ID).toBe('memory-pressure.oom-margin');
    expect(MEMORY_PRESSURE_OOM_MARGIN_TURBO_VERSION).toBe(1);
    expect(MEMORY_PRESSURE_OOM_MARGIN_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(MEMORY_PRESSURE_OOM_MARGIN_TRIGGERS)).toBe(true);
  });

  test('classifies safe, narrow, critical, and converging margins', () => {
    const safe = runMemoryPressureOomMarginTurbo([
      snapshot(50), snapshot(51), snapshot(50)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(safe).toMatchObject({ sampleCount: 3, observedCount: 3,
      unknownCount: 0, invalidCount: 0, criticalCount: 0, narrowCount: 0,
      meanMargin: 49.6667, minimumMargin: 49, slope: 0,
      state: 'safe-margin', confidence: 1, recommendations: ['no-change'], actions: [] });

    const narrow = runMemoryPressureOomMarginTurbo([
      snapshot(85), snapshot(88)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(narrow).toMatchObject({ criticalCount: 0, narrowCount: 2,
      state: 'narrow-margin', recommendations: ['protect-memory-margin', 'observe-next-sample'] });

    const critical = runMemoryPressureOomMarginTurbo([
      snapshot(98), snapshot(99)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(critical).toMatchObject({ criticalCount: 2, narrowCount: 2,
      state: 'critical-margin', recommendations: ['protect-critical-memory-margin', 'hold-destructive-actions'] });

    const converging = runMemoryPressureOomMarginTurbo([
      snapshot(40), snapshot(50), snapshot(60)
    ], { trigger: 'health.interval', declineThreshold: 5, now: () => 0 });
    expect(converging).toMatchObject({ criticalCount: 0, narrowCount: 0,
      slope: -5, state: 'converging-margin', recommendations: ['observe-memory-margin-decline'] });
    expect(Object.isFrozen(safe)).toBe(true);
    expect(Object.isFrozen(safe.actions)).toBe(true);
  });

  test('bounds windows, handles sparse evidence, and preserves sensor refusal', () => {
    const empty = runMemoryPressureOomMarginTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      invalidCount: 0, meanMargin: null, minimumMargin: null, slope: null,
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-margin-samples'] });

    const insufficient = runMemoryPressureOomMarginTurbo([snapshot(50)], {
      trigger: 'health.interval', now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const bounded = runMemoryPressureOomMarginTurbo([
      snapshot(20), snapshot(40), snapshot(60), snapshot(80)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2,
      criticalMarginThreshold: 1, narrowMarginThreshold: 1, declineThreshold: 5, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, observedCount: 2, slope: -20,
      state: 'converging-margin' });

    const unknown = runMemoryPressureOomMarginTurbo([
      snapshot(null, null, null), snapshot(null, null, 0)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, invalidCount: 0,
      state: 'no-observation', confidence: 0,
      recommendations: ['request-memory-margin-observation'] });

    const invalid = runMemoryPressureOomMarginTurbo([
      snapshot(120, 1200, 1000), snapshot(50)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(invalid).toMatchObject({ observedCount: 1, unknownCount: 0, invalidCount: 1,
      state: 'invalid-margin-evidence', recommendations: ['review-memory-sensor-range'] });
  });

  test('uses headroom when total memory is absent and clamps sensor values', () => {
    const headroomOnly = runMemoryPressureOomMarginTurbo([
      snapshot(50, null, null), snapshot(50, null, null)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(headroomOnly).toMatchObject({ observedCount: 2, meanMargin: 50,
      state: 'safe-margin' });

    const normalized = runMemoryPressureOomMarginTurbo([
      snapshot(-10, -1, 1000), snapshot(110, 100, 1000)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(normalized).toMatchObject({ observedCount: 0, invalidCount: 2 });
  });

  test('rejects malformed inputs, bounds, thresholds, snapshots, and clocks', () => {
    expect(() => runMemoryPressureOomMarginTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runMemoryPressureOomMarginTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported memory-pressure oom-margin trigger: bad');
    expect(() => runMemoryPressureOomMarginTurbo()).toThrow(
      'Unsupported memory-pressure oom-margin trigger: unknown'
    );
    expect(() => runMemoryPressureOomMarginTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPressureOomMarginTurbo([], {
      trigger: 'health.interval', windowSize: 65
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runMemoryPressureOomMarginTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runMemoryPressureOomMarginTurbo([], {
      trigger: 'health.interval', minimumSamples: 0
    })).toThrow('minimumSamples must fit inside the window');
    for (const option of ['criticalMarginThreshold', 'narrowMarginThreshold', 'declineThreshold']) {
      expect(() => runMemoryPressureOomMarginTurbo([], {
        trigger: 'health.interval', [option]: -1
      })).toThrow(`${option} must be between 0 and 100`);
      expect(() => runMemoryPressureOomMarginTurbo([], {
        trigger: 'health.interval', [option]: 101
      })).toThrow(`${option} must be between 0 and 100`);
    }
    for (const option of ['criticalCountThreshold', 'narrowCountThreshold']) {
      expect(() => runMemoryPressureOomMarginTurbo([], {
        trigger: 'health.interval', [option]: 0
      })).toThrow(`${option} must be an integer from 1 to 64`);
      expect(() => runMemoryPressureOomMarginTurbo([], {
        trigger: 'health.interval', [option]: 65
      })).toThrow(`${option} must be an integer from 1 to 64`);
    }
    expect(() => runMemoryPressureOomMarginTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runMemoryPressureOomMarginTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runMemoryPressureOomMarginTurbo([
      { engine: 'other' }, snapshot(50)
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runMemoryPressureOomMarginTurbo([
      snapshot(50, 500, 1000, { memory: null }), snapshot(50)
    ], { trigger: 'health.interval' })).toThrow('requires a memory section');
  });
});
