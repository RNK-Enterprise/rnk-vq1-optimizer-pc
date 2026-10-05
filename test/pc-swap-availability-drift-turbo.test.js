import {
  SWAP_AVAILABILITY_DRIFT_TURBO_ID,
  SWAP_AVAILABILITY_DRIFT_TURBO_VERSION,
  SWAP_AVAILABILITY_DRIFT_TRIGGERS,
  runSwapAvailabilityDriftTurbo
} from '../pc/engines/swap/turbos/availability-drift/turbo.js';

function snapshot(totalBytes) {
  return { engine: 'system-facts', memory: { swapTotalBytes: totalBytes } };
}

describe('Swap availability-drift turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(SWAP_AVAILABILITY_DRIFT_TURBO_ID).toBe('swap.availability-drift');
    expect(SWAP_AVAILABILITY_DRIFT_TURBO_VERSION).toBe(1);
    expect(SWAP_AVAILABILITY_DRIFT_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    const report = runSwapAvailabilityDriftTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(report).toMatchObject({ protocolVersion: 1, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.recommendations)).toBe(true);
    expect(Object.isFrozen(report.actions)).toBe(true);
  });

  test('classifies availability drift, capacity loss, gain, and stable posture', () => {
    const drift = runSwapAvailabilityDriftTurbo([
      snapshot(0), snapshot(1024)
    ], { trigger: 'health.interval', now: () => 1 });
    expect(drift).toMatchObject({ noneCount: 1, increaseCount: 1,
      availabilityChanges: 1, state: 'availability-drift',
      recommendations: ['review-swap-availability-change', 'hold-automatic-creation'] });

    const loss = runSwapAvailabilityDriftTurbo([
      snapshot(4096), snapshot(2048)
    ], { trigger: 'workload.changed', now: () => 2 });
    expect(loss).toMatchObject({ decreaseCount: 1, availabilityChanges: 0,
      state: 'capacity-loss', recommendations: ['review-swap-capacity-loss'] });

    const gain = runSwapAvailabilityDriftTurbo([
      snapshot(1024), snapshot(4096)
    ], { trigger: 'system.facts.request', now: () => 3 });
    expect(gain).toMatchObject({ increaseCount: 1, state: 'capacity-gain',
      recommendations: ['observe-new-swap-capacity'] });

    const stable = runSwapAvailabilityDriftTurbo([
      snapshot(1024), snapshot(1024)
    ], { trigger: 'health.interval', now: () => 4 });
    expect(stable).toMatchObject({ increaseCount: 0, decreaseCount: 0,
      state: 'stable-availability', recommendations: ['no-change'] });
  });

  test('preserves no-swap, unknown, invalid, and bounded evidence', () => {
    const none = runSwapAvailabilityDriftTurbo([
      snapshot(0), snapshot(0)
    ], { trigger: 'health.interval', now: () => 5 });
    expect(none).toMatchObject({ noneCount: 2, observedCount: 0, unknownCount: 0,
      state: 'no-swap', recommendations: ['no-change', 'keep-no-swap-user-owned'] });

    const unknown = runSwapAvailabilityDriftTurbo([
      snapshot(undefined), snapshot(undefined)
    ], { trigger: 'health.interval', now: () => 6 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, state: 'no-observation',
      recommendations: ['request-swap-availability-observation'] });

    const invalid = runSwapAvailabilityDriftTurbo([
      snapshot(-1), snapshot(1024)
    ], { trigger: 'health.interval', now: () => 7 });
    expect(invalid).toMatchObject({ invalidCount: 1, state: 'invalid-availability-evidence',
      recommendations: ['review-swap-capacity-sensor-range'] });

    const bounded = runSwapAvailabilityDriftTurbo([
      snapshot(1024), snapshot(1024), snapshot(4096)
    ], { trigger: 'health.interval', windowSize: 2, changeThresholdBytes: 1000, now: () => 8 });
    expect(bounded).toMatchObject({ sampleCount: 2, increaseCount: 1, state: 'capacity-gain' });
  });

  test('rejects malformed snapshots and unsupported input', () => {
    expect(() => runSwapAvailabilityDriftTurbo('bad', { trigger: 'health.interval' }))
      .toThrow(TypeError);
    expect(() => runSwapAvailabilityDriftTurbo([null, snapshot(1024)], {
      trigger: 'health.interval', now: () => 9
    })).toThrow(TypeError);
    expect(() => runSwapAvailabilityDriftTurbo([
      { engine: 'wrong', memory: {} }, snapshot(1024)
    ], { trigger: 'health.interval', now: () => 9 })).toThrow(Error);
    expect(() => runSwapAvailabilityDriftTurbo([
      { engine: 'system-facts' }, snapshot(1024)
    ], { trigger: 'health.interval', now: () => 9 })).toThrow(TypeError);
  });

  test('rejects unsupported triggers, ranges, and clocks', () => {
    expect(() => runSwapAvailabilityDriftTurbo()).toThrow('Unsupported swap availability-drift trigger: unknown');
    expect(() => runSwapAvailabilityDriftTurbo([], { trigger: 'unsupported' }))
      .toThrow('Unsupported swap availability-drift trigger');
    expect(() => runSwapAvailabilityDriftTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow(RangeError);
    expect(() => runSwapAvailabilityDriftTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow(RangeError);
    expect(() => runSwapAvailabilityDriftTurbo([], {
      trigger: 'health.interval', windowSize: 4, minimumSamples: 5
    })).toThrow(RangeError);
    expect(() => runSwapAvailabilityDriftTurbo([], { trigger: 'health.interval', changeThresholdBytes: -1 }))
      .toThrow(RangeError);
    expect(() => runSwapAvailabilityDriftTurbo([], { trigger: 'health.interval', changeThresholdBytes: 1e15 + 1 }))
      .toThrow(RangeError);
    expect(() => runSwapAvailabilityDriftTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow(TypeError);
  });
});
