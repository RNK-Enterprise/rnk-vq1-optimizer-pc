import {
  SWAP_PRESSURE_DWELL_TURBO_ID,
  SWAP_PRESSURE_DWELL_TURBO_VERSION,
  SWAP_PRESSURE_DWELL_TRIGGERS,
  runSwapPressureDwellTurbo
} from '../pc/engines/swap/turbos/pressure-dwell/turbo.js';

function snapshot(totalBytes, usedPercent) {
  return { engine: 'system-facts', memory: { swapTotalBytes: totalBytes, swapUsedPercent: usedPercent } };
}

describe('Swap pressure-dwell turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(SWAP_PRESSURE_DWELL_TURBO_ID).toBe('swap.pressure-dwell');
    expect(SWAP_PRESSURE_DWELL_TURBO_VERSION).toBe(1);
    expect(SWAP_PRESSURE_DWELL_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    const report = runSwapPressureDwellTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(report).toMatchObject({ protocolVersion: 1, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.recommendations)).toBe(true);
    expect(Object.isFrozen(report.actions)).toBe(true);
  });

  test('classifies sustained high, sustained elevated, and transient states', () => {
    const high = runSwapPressureDwellTurbo([
      snapshot(1024, 80), snapshot(1024, 90)
    ], { trigger: 'health.interval', now: () => 1 });
    expect(high).toMatchObject({ observedCount: 2, highCount: 2, elevatedCount: 0,
      state: 'sustained-high', recommendations: ['hold-destructive-actions', 'review-memory-pressure'] });

    const elevated = runSwapPressureDwellTurbo([
      snapshot(1024, 40), snapshot(1024, 60)
    ], { trigger: 'workload.changed', now: () => 2 });
    expect(elevated).toMatchObject({ highCount: 0, elevatedCount: 2,
      state: 'sustained-elevated', recommendations: ['observe-next-swap-sample', 'review-documented-swap-policy'] });

    const transient = runSwapPressureDwellTurbo([
      snapshot(1024, 20), snapshot(1024, 80)
    ], { trigger: 'system.facts.request', dwellThreshold: 2, now: () => 3 });
    expect(transient).toMatchObject({ highCount: 1, state: 'transient-or-normal',
      recommendations: ['no-change'] });

    const none = runSwapPressureDwellTurbo([
      snapshot(0, 0), snapshot(0, 0)
    ], { trigger: 'health.interval', now: () => 4 });
    expect(none).toMatchObject({ observedCount: 2, state: 'transient-or-normal' });
  });

  test('bounds windows and preserves missing or invalid evidence', () => {
    const unknown = runSwapPressureDwellTurbo([
      snapshot(undefined, undefined), snapshot(undefined, undefined)
    ], { trigger: 'health.interval', now: () => 5 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, state: 'no-observation',
      recommendations: ['request-swap-observation'] });

    const invalid = runSwapPressureDwellTurbo([
      snapshot(-1, 20), snapshot(1024, 101)
    ], { trigger: 'health.interval', now: () => 6 });
    expect(invalid).toMatchObject({ invalidCount: 2, state: 'invalid-pressure-evidence',
      recommendations: ['review-swap-sensor-range'] });

    const bounded = runSwapPressureDwellTurbo([
      snapshot(1024, 80), snapshot(1024, 80), snapshot(1024, 20)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 7 });
    expect(bounded).toMatchObject({ sampleCount: 2, highCount: 1, state: 'transient-or-normal' });
  });

  test('rejects malformed snapshots and unsupported input', () => {
    expect(() => runSwapPressureDwellTurbo('bad', { trigger: 'health.interval' })).toThrow(TypeError);
    expect(() => runSwapPressureDwellTurbo([null, snapshot(1024, 20)], {
      trigger: 'health.interval', now: () => 8
    })).toThrow(TypeError);
    expect(() => runSwapPressureDwellTurbo([
      { engine: 'wrong', memory: {} }, snapshot(1024, 20)
    ], { trigger: 'health.interval', now: () => 8 })).toThrow(Error);
    expect(() => runSwapPressureDwellTurbo([
      { engine: 'system-facts' }, snapshot(1024, 20)
    ], { trigger: 'health.interval', now: () => 8 })).toThrow(TypeError);
  });

  test('rejects unsupported triggers, ranges, and clocks', () => {
    expect(() => runSwapPressureDwellTurbo()).toThrow('Unsupported swap pressure-dwell trigger: unknown');
    expect(() => runSwapPressureDwellTurbo([], { trigger: 'unsupported' }))
      .toThrow('Unsupported swap pressure-dwell trigger');
    expect(() => runSwapPressureDwellTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow(RangeError);
    expect(() => runSwapPressureDwellTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow(RangeError);
    expect(() => runSwapPressureDwellTurbo([], {
      trigger: 'health.interval', windowSize: 4, minimumSamples: 5
    })).toThrow(RangeError);
    expect(() => runSwapPressureDwellTurbo([], { trigger: 'health.interval', dwellThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runSwapPressureDwellTurbo([], { trigger: 'health.interval', dwellThreshold: 65 }))
      .toThrow(RangeError);
    expect(() => runSwapPressureDwellTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow(TypeError);
  });
});
