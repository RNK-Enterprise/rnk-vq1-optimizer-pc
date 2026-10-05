import {
  SWAP_HEADROOM_COLLAPSE_TURBO_ID,
  SWAP_HEADROOM_COLLAPSE_TURBO_VERSION,
  SWAP_HEADROOM_COLLAPSE_TRIGGERS,
  runSwapHeadroomCollapseTurbo
} from '../pc/engines/swap/turbos/headroom-collapse/turbo.js';

function snapshot(totalBytes, freeBytes) {
  return { engine: 'system-facts', memory: { swapTotalBytes: totalBytes, swapFreeBytes: freeBytes } };
}

describe('Swap headroom-collapse turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(SWAP_HEADROOM_COLLAPSE_TURBO_ID).toBe('swap.headroom-collapse');
    expect(SWAP_HEADROOM_COLLAPSE_TURBO_VERSION).toBe(1);
    expect(SWAP_HEADROOM_COLLAPSE_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    const report = runSwapHeadroomCollapseTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(report).toMatchObject({ protocolVersion: 1, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.recommendations)).toBe(true);
    expect(Object.isFrozen(report.actions)).toBe(true);
  });

  test('classifies headroom collapse, recovery, and stable posture', () => {
    const collapse = runSwapHeadroomCollapseTurbo([
      snapshot(1000, 900), snapshot(1000, 700), snapshot(1000, 500)
    ], { trigger: 'health.interval', collapseThreshold: 10, now: () => 1 });
    expect(collapse).toMatchObject({ observedCount: 3, collapseCount: 2, recoveryCount: 0,
      comparisonCount: 2, state: 'headroom-collapse',
      recommendations: ['hold-destructive-actions', 'observe-swap-headroom'] });

    const recovery = runSwapHeadroomCollapseTurbo([
      snapshot(1000, 300), snapshot(1000, 500), snapshot(1000, 700)
    ], { trigger: 'workload.changed', recoveryThreshold: 10, now: () => 2 });
    expect(recovery).toMatchObject({ collapseCount: 0, recoveryCount: 2,
      state: 'headroom-recovery', recommendations: ['observe-swap-headroom-recovery'] });

    const stable = runSwapHeadroomCollapseTurbo([
      snapshot(1000, 500), snapshot(1000, 505)
    ], { trigger: 'system.facts.request', now: () => 3 });
    expect(stable).toMatchObject({ collapseCount: 0, recoveryCount: 0,
      state: 'stable-headroom', recommendations: ['no-change'] });
  });

  test('preserves no-swap, unknown, invalid, and bounded evidence', () => {
    const none = runSwapHeadroomCollapseTurbo([
      snapshot(0, 0), snapshot(0, 0)
    ], { trigger: 'health.interval', now: () => 4 });
    expect(none).toMatchObject({ noSwapCount: 2, observedCount: 0, unknownCount: 0,
      state: 'no-swap', recommendations: ['no-change', 'keep-no-swap-user-owned'] });

    const unknown = runSwapHeadroomCollapseTurbo([
      snapshot(undefined, undefined), snapshot(undefined, undefined)
    ], { trigger: 'health.interval', now: () => 5 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, state: 'no-observation',
      recommendations: ['request-swap-headroom-observation'] });

    const invalid = runSwapHeadroomCollapseTurbo([
      snapshot(-1, 0), snapshot(1000, 1200)
    ], { trigger: 'health.interval', now: () => 6 });
    expect(invalid).toMatchObject({ invalidCount: 2, state: 'invalid-headroom-evidence',
      recommendations: ['review-swap-capacity-sensor-range'] });

    const bounded = runSwapHeadroomCollapseTurbo([
      snapshot(1000, 900), snapshot(1000, 600), snapshot(1000, 300)
    ], { trigger: 'health.interval', windowSize: 2, now: () => 7 });
    expect(bounded).toMatchObject({ sampleCount: 2, collapseCount: 1, state: 'headroom-collapse' });
  });

  test('rejects malformed snapshots and unsupported input', () => {
    expect(() => runSwapHeadroomCollapseTurbo('bad', { trigger: 'health.interval' }))
      .toThrow(TypeError);
    expect(() => runSwapHeadroomCollapseTurbo([null, snapshot(1000, 500)], {
      trigger: 'health.interval', now: () => 8
    })).toThrow(TypeError);
    expect(() => runSwapHeadroomCollapseTurbo([
      { engine: 'wrong', memory: {} }, snapshot(1000, 500)
    ], { trigger: 'health.interval', now: () => 8 })).toThrow(Error);
    expect(() => runSwapHeadroomCollapseTurbo([
      { engine: 'system-facts' }, snapshot(1000, 500)
    ], { trigger: 'health.interval', now: () => 8 })).toThrow(TypeError);
  });

  test('rejects unsupported triggers, ranges, and clocks', () => {
    expect(() => runSwapHeadroomCollapseTurbo()).toThrow('Unsupported swap headroom-collapse trigger: unknown');
    expect(() => runSwapHeadroomCollapseTurbo([], { trigger: 'unsupported' }))
      .toThrow('Unsupported swap headroom-collapse trigger');
    expect(() => runSwapHeadroomCollapseTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow(RangeError);
    expect(() => runSwapHeadroomCollapseTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow(RangeError);
    expect(() => runSwapHeadroomCollapseTurbo([], {
      trigger: 'health.interval', windowSize: 4, minimumSamples: 5
    })).toThrow(RangeError);
    expect(() => runSwapHeadroomCollapseTurbo([], { trigger: 'health.interval', collapseThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runSwapHeadroomCollapseTurbo([], { trigger: 'health.interval', recoveryThreshold: 101 }))
      .toThrow(RangeError);
    expect(() => runSwapHeadroomCollapseTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow(TypeError);
  });
});
