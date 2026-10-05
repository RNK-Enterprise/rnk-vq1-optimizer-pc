import {
  MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_TURBO_ID,
  MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_TURBO_VERSION,
  MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_TRIGGERS,
  runMemoryPolicySwapPolicyAlignmentTurbo
} from '../pc/engines/memory-policy/turbos/swap-policy-alignment/turbo.js';

function snapshot(swapUsedPercent, usedPercent, currentPolicy = undefined) {
  const memory = { swapUsedPercent, usedPercent };
  if (currentPolicy !== undefined) memory.currentPolicy = currentPolicy;
  return { engine: 'system-facts', memory };
}

describe('Memory-policy swap-policy-alignment turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_TURBO_ID)
      .toBe('memory-policy.swap-policy-alignment');
    expect(MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_TURBO_VERSION).toBe(1);
    expect(MEMORY_POLICY_SWAP_POLICY_ALIGNMENT_TRIGGERS)
      .toEqual(['system.facts.request', 'workload.changed', 'health.interval']);
    const report = runMemoryPolicySwapPolicyAlignmentTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(report).toMatchObject({ protocolVersion: 1, sampleCount: 0,
      state: 'insufficient-data', confidence: 0, generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.recommendations)).toBe(true);
    expect(Object.isFrozen(report.actions)).toBe(true);
  });

  test('classifies aligned, elevated gaps, critical gaps, and policy absence', () => {
    const aligned = runMemoryPolicySwapPolicyAlignmentTurbo([
      snapshot(10, 30, 'balanced'), snapshot(20, 40, 'balanced')
    ], { trigger: 'system.facts.request', now: () => 1 });
    expect(aligned).toMatchObject({ swapObservedCount: 2, policyObservedCount: 2,
      mismatchCount: 0, criticalMismatchCount: 0, state: 'aligned-swap-policy', confidence: 1,
      recommendations: ['no-change'] });

    const elevated = runMemoryPolicySwapPolicyAlignmentTurbo([
      snapshot(50, 30, 'balanced'), snapshot(60, 40, 'balanced')
    ], { trigger: 'workload.changed', now: () => 2 });
    expect(elevated).toMatchObject({ mismatchCount: 2, criticalMismatchCount: 0,
      state: 'swap-policy-gap', recommendations: ['review-swap-aware-memory-policy'] });

    const critical = runMemoryPolicySwapPolicyAlignmentTurbo([
      snapshot(80, 30, 'balanced'), snapshot(90, 40, 'background-low')
    ], { trigger: 'health.interval', now: () => 3 });
    expect(critical).toMatchObject({ mismatchCount: 2, criticalMismatchCount: 2,
      state: 'critical-swap-policy-gap', recommendations: [
        'hold-current-under-critical-swap', 'review-policy-consent'
      ] });

    const noPolicy = runMemoryPolicySwapPolicyAlignmentTurbo([
      snapshot(10, 30), snapshot(20, 40)
    ], { trigger: 'health.interval', now: () => 4 });
    expect(noPolicy).toMatchObject({ swapObservedCount: 2, policyObservedCount: 0,
      state: 'policy-observation-required', recommendations: ['request-memory-policy-observation'] });
  });

  test('bounds windows, handles missing swap, and preserves refusal states', () => {
    const missing = runMemoryPolicySwapPolicyAlignmentTurbo([
      snapshot(undefined, 30, 'balanced'), snapshot(undefined, 40, 'balanced')
    ], { trigger: 'health.interval', now: () => 5 });
    expect(missing).toMatchObject({ observedCount: 0, swapObservedCount: 0,
      state: 'no-observation', recommendations: ['request-swap-observation'] });

    const partial = runMemoryPolicySwapPolicyAlignmentTurbo([
      snapshot(10, 30, 'balanced'), snapshot(undefined, 40, 'balanced'),
      snapshot(undefined, 45, 'balanced')
    ], { trigger: 'health.interval', windowSize: 3, minimumSamples: 2, now: () => 6 });
    expect(partial).toMatchObject({ sampleCount: 3, observedCount: 1,
      state: 'swap-observation-required', recommendations: ['collect-complete-swap-window'] });

    const insufficient = runMemoryPolicySwapPolicyAlignmentTurbo(
      [snapshot(10, 30, 'balanced')], {
        trigger: 'system.facts.request', minimumSamples: 2, now: () => 7
      });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data',
      recommendations: ['collect-more-swap-policy-samples'] });
  });

  test('handles invalid ranges, unknown pressure, and malformed snapshots', () => {
    const invalid = runMemoryPolicySwapPolicyAlignmentTurbo([
      snapshot(101, 30, 'balanced'), snapshot(-1, 40, 'balanced')
    ], { trigger: 'health.interval', now: () => 8 });
    expect(invalid).toMatchObject({ invalidCount: 2, state: 'invalid-swap-evidence',
      recommendations: ['review-swap-sensor-range'] });

    const unknown = runMemoryPolicySwapPolicyAlignmentTurbo([
      snapshot(undefined, undefined, 'hold-current'), snapshot(undefined, undefined, 'hold-current')
    ], { trigger: 'health.interval', now: () => 9 });
    expect(unknown).toMatchObject({ observedCount: 0, state: 'no-observation' });

    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo([
      snapshot(10, 30, 'not-a-policy'), snapshot(10, 30, 'balanced')
    ], { trigger: 'health.interval', now: () => 10 })).not.toThrow();
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo([null, snapshot(10, 30, 'balanced')], {
      trigger: 'health.interval', now: () => 10
    })).toThrow(TypeError);
  });

  test('rejects unsupported triggers, bounds, and clocks', () => {
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo()).toThrow(
      'Unsupported memory-policy swap-policy-alignment trigger: unknown'
    );
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo([], {
      trigger: undefined
    })).toThrow('Unsupported memory-policy swap-policy-alignment trigger: unknown');
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo([], {
      trigger: 'unsupported'
    })).toThrow('Unsupported memory-policy swap-policy-alignment trigger');
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo('bad', {
      trigger: 'health.interval'
    })).toThrow(TypeError);
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow(RangeError);
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo([], {
      trigger: 'health.interval', windowSize: 65
    })).toThrow(RangeError);
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo([], {
      trigger: 'health.interval', windowSize: 4, minimumSamples: 5
    })).toThrow(RangeError);
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo([], {
      trigger: 'health.interval', gapThreshold: 0
    })).toThrow(RangeError);
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo([], {
      trigger: 'health.interval', gapThreshold: 65
    })).toThrow(RangeError);
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow(TypeError);
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo([
      { engine: 'wrong', memory: {} }, snapshot(10, 30, 'balanced')
    ], { trigger: 'health.interval', now: () => 11 })).toThrow(Error);
    expect(() => runMemoryPolicySwapPolicyAlignmentTurbo([
      { engine: 'system-facts' }, snapshot(10, 30, 'balanced')
    ], { trigger: 'health.interval', now: () => 11 })).toThrow(TypeError);
  });
});
