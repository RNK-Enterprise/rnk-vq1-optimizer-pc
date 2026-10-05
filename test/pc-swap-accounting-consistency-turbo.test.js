import {
  SWAP_ACCOUNTING_CONSISTENCY_TURBO_ID,
  SWAP_ACCOUNTING_CONSISTENCY_TURBO_VERSION,
  SWAP_ACCOUNTING_CONSISTENCY_TRIGGERS,
  runSwapAccountingConsistencyTurbo
} from '../pc/engines/swap/turbos/accounting-consistency/turbo.js';

function snapshot(totalBytes, freeBytes, usedPercent) {
  return { engine: 'system-facts', memory: {
    swapTotalBytes: totalBytes, swapFreeBytes: freeBytes, swapUsedPercent: usedPercent
  } };
}

describe('Swap accounting-consistency turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(SWAP_ACCOUNTING_CONSISTENCY_TURBO_ID).toBe('swap.accounting-consistency');
    expect(SWAP_ACCOUNTING_CONSISTENCY_TURBO_VERSION).toBe(1);
    expect(SWAP_ACCOUNTING_CONSISTENCY_TRIGGERS).toEqual([
      'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    const report = runSwapAccountingConsistencyTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(report).toMatchObject({ protocolVersion: 1, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.recommendations)).toBe(true);
    expect(Object.isFrozen(report.actions)).toBe(true);
  });

  test('classifies consistent accounting and accounting drift', () => {
    const consistent = runSwapAccountingConsistencyTurbo([
      snapshot(1000, 700, 30), snapshot(1000, 500, 50)
    ], { trigger: 'health.interval', consistencyThreshold: 1, now: () => 1 });
    expect(consistent).toMatchObject({ observedCount: 2, consistentCount: 2,
      driftCount: 0, state: 'accounting-consistent', recommendations: ['no-change'] });

    const drift = runSwapAccountingConsistencyTurbo([
      snapshot(1000, 700, 50), snapshot(1000, 500, 30)
    ], { trigger: 'workload.changed', consistencyThreshold: 5, now: () => 2 });
    expect(drift).toMatchObject({ observedCount: 2, consistentCount: 0, driftCount: 2,
      state: 'accounting-drift', recommendations: ['hold-swap-policy-automation', 'review-sensor-agreement'] });

    const boundary = runSwapAccountingConsistencyTurbo([
      snapshot(1000, 700, 40), snapshot(1000, 500, 60)
    ], { trigger: 'system.facts.request', consistencyThreshold: 10, now: () => 3 });
    expect(boundary).toMatchObject({ state: 'accounting-consistent' });
  });

  test('preserves no-swap, unknown, invalid, and bounded evidence', () => {
    const none = runSwapAccountingConsistencyTurbo([
      snapshot(0, 0, 0), snapshot(0, 0, 0)
    ], { trigger: 'health.interval', now: () => 4 });
    expect(none).toMatchObject({ noSwapCount: 2, observedCount: 0, unknownCount: 0,
      state: 'no-swap', recommendations: ['no-change', 'keep-no-swap-user-owned'] });

    const unknown = runSwapAccountingConsistencyTurbo([
      snapshot(undefined, undefined, undefined), snapshot(undefined, undefined, undefined)
    ], { trigger: 'health.interval', now: () => 5 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, state: 'no-observation',
      recommendations: ['request-swap-accounting-observation'] });

    const invalid = runSwapAccountingConsistencyTurbo([
      snapshot(-1, 0, 0), snapshot(1000, 1200, 20), snapshot(1000, 0, 101)
    ], { trigger: 'health.interval', now: () => 6 });
    expect(invalid).toMatchObject({ invalidCount: 3, state: 'invalid-accounting-evidence',
      recommendations: ['review-swap-accounting-sensors'] });

    const bounded = runSwapAccountingConsistencyTurbo([
      snapshot(1000, 800, 20), snapshot(1000, 500, 50), snapshot(1000, 500, 50)
    ], { trigger: 'health.interval', windowSize: 2, now: () => 7 });
    expect(bounded).toMatchObject({ sampleCount: 2, consistentCount: 2, state: 'accounting-consistent' });
  });

  test('rejects malformed snapshots and unsupported input', () => {
    expect(() => runSwapAccountingConsistencyTurbo('bad', { trigger: 'health.interval' }))
      .toThrow(TypeError);
    expect(() => runSwapAccountingConsistencyTurbo([null, snapshot(1000, 500, 50)], {
      trigger: 'health.interval', now: () => 8
    })).toThrow(TypeError);
    expect(() => runSwapAccountingConsistencyTurbo([
      { engine: 'wrong', memory: {} }, snapshot(1000, 500, 50)
    ], { trigger: 'health.interval', now: () => 8 })).toThrow(Error);
    expect(() => runSwapAccountingConsistencyTurbo([
      { engine: 'system-facts' }, snapshot(1000, 500, 50)
    ], { trigger: 'health.interval', now: () => 8 })).toThrow(TypeError);
  });

  test('rejects unsupported triggers, ranges, and clocks', () => {
    expect(() => runSwapAccountingConsistencyTurbo()).toThrow('Unsupported swap accounting-consistency trigger: unknown');
    expect(() => runSwapAccountingConsistencyTurbo([], { trigger: 'unsupported' }))
      .toThrow('Unsupported swap accounting-consistency trigger');
    expect(() => runSwapAccountingConsistencyTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow(RangeError);
    expect(() => runSwapAccountingConsistencyTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow(RangeError);
    expect(() => runSwapAccountingConsistencyTurbo([], {
      trigger: 'health.interval', windowSize: 4, minimumSamples: 5
    })).toThrow(RangeError);
    expect(() => runSwapAccountingConsistencyTurbo([], { trigger: 'health.interval', consistencyThreshold: -1 }))
      .toThrow(RangeError);
    expect(() => runSwapAccountingConsistencyTurbo([], { trigger: 'health.interval', consistencyThreshold: 101 }))
      .toThrow(RangeError);
    expect(() => runSwapAccountingConsistencyTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow(TypeError);
  });
});
